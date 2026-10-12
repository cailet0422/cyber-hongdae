// 외부 공개: Cloudflare 퀵터널 / UPnP 포트포워딩 / LAN 주소
const os = require('os');
const { spawn } = require('child_process');
const { TOOLS, run } = require('./tools');

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal && !/^169\.254/.test(a.address)) out.push({ name, address: a.address });
    }
  }
  // 사설망 대역 우선 (192.168 > 10 > 172), 가상 어댑터는 뒤로
  const score = (x) => (/vEthernet|VMware|VirtualBox|Hyper-V|Loopback|tailscale|ZeroTier/i.test(x.name) ? 10 : 0) + (/^192\.168/.test(x.address) ? 0 : /^10\./.test(x.address) ? 1 : 2);
  return out.sort((a, b) => score(a) - score(b));
}

class QuickTunnel {
  constructor(port, log) { this.port = port; this.log = log; this.proc = null; this.url = null; }
  start() {
    return new Promise((resolve, reject) => {
      const args = ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${this.port}`];
      try {
        this.proc = spawn(TOOLS.cloudflared, args, { windowsHide: true });
      } catch (e) { return reject(e); }
      const timer = setTimeout(() => reject(new Error('Cloudflare 터널 주소를 받지 못했습니다(시간 초과). 인터넷 연결을 확인하세요.')), 45000);
      const onData = (d) => {
        const s = d.toString();
        for (const line of s.split('\n')) if (line.trim()) this.log?.(line.trim().replace(/^\S+\s+/, ''));
        const m = s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (m && !this.url) { this.url = m[0]; clearTimeout(timer); resolve(this.url); }
      };
      this.proc.stdout.on('data', onData);
      this.proc.stderr.on('data', onData);
      this.proc.on('error', (e) => { clearTimeout(timer); reject(e); });
      this.proc.on('exit', (code) => {
        clearTimeout(timer);
        if (!this.url) reject(new Error('cloudflared가 종료되었습니다 (코드 ' + code + ')'));
        this.onExit?.(code);
      });
    });
  }
  stop() { try { this.proc?.kill(); } catch {} this.proc = null; this.url = null; }
}

class Upnp {
  constructor(port, log) { this.port = port; this.log = log; this.client = null; }
  async start() {
    const NatAPI = require('nat-api');
    this.client = new NatAPI({ ttl: 3600, autoUpdate: true, enablePMP: true });
    await new Promise((res, rej) => this.client.map({ publicPort: this.port, privatePort: this.port, protocol: 'TCP' }, (e) => (e ? rej(new Error('공유기가 UPnP를 지원하지 않거나 꺼져 있습니다: ' + (e.message || e))) : res())));
    let ip = await new Promise((res) => this.client.externalIp((e, ip) => res(e ? null : ip)));
    if (!ip) ip = await publicIp();
    if (!ip) throw new Error('외부 IP를 확인하지 못했습니다');
    return `http://${ip}:${this.port}`;
  }
  stop() {
    if (!this.client) return;
    const c = this.client;
    this.client = null;
    c.unmap({ publicPort: this.port, privatePort: this.port, protocol: 'TCP' }, () => c.destroy());
  }
}

// Tailscale Funnel: https://<기기이름>.<tailnet>.ts.net 주소로 공개. 방문자에게 내 IP가 보이지 않는다.
// 포그라운드로 실행하므로 프로세스를 끝내면 Funnel 설정도 자동으로 사라진다(사용자 tailnet 설정을 남기지 않음).
class TailscaleFunnel {
  constructor(port, log) { this.port = port; this.log = log; this.proc = null; this.url = null; }

  async start() {
    const ts = TOOLS.tailscale;
    const st = await run(ts, ['status', '--json'], { timeout: 15000 });
    if (st.code !== 0 && !st.stdout) {
      throw new Error('Tailscale이 설치되어 있지 않습니다. https://tailscale.com/download 에서 설치하고 로그인한 뒤 다시 시도하세요.');
    }
    let status;
    try { status = JSON.parse(st.stdout); } catch { throw new Error('Tailscale 상태를 읽지 못했습니다: ' + (st.stderr || st.stdout).trim().slice(0, 200)); }
    if (status.BackendState !== 'Running') {
      throw new Error(`Tailscale이 실행 중이 아닙니다 (상태: ${status.BackendState}). 작업 표시줄의 Tailscale 아이콘에서 로그인/연결하세요.`);
    }
    const dns = (status.Self?.DNSName || '').replace(/\.$/, '');
    if (!dns) throw new Error('Tailscale 기기 이름(MagicDNS)을 확인하지 못했습니다. 관리 페이지에서 MagicDNS와 HTTPS를 켜 주세요.');
    const caps = [...(status.Self?.Capabilities || []), ...Object.keys(status.Self?.CapMap || {})].join(' ');
    // Funnel 허용 포트 중 비어 있는 포트 선택
    let allowed = [443, 8443, 10000];
    const m = caps.match(/funnel-ports\?ports=([\d,]+)/);
    if (m) allowed = m[1].split(',').map(Number);
    const used = new Set();
    const ss = await run(ts, ['serve', 'status', '--json'], { timeout: 10000 });
    try {
      const j = JSON.parse(ss.stdout || '{}');
      for (const k of Object.keys(j.TCP || {})) used.add(+k);
    } catch {}
    const httpsPort = allowed.find((p) => !used.has(p));
    if (!httpsPort) throw new Error('Funnel에 쓸 수 있는 포트(443/8443/10000)가 모두 사용 중입니다. tailscale serve 설정을 확인하세요.');

    return new Promise((resolve, reject) => {
      this.proc = spawn(ts, ['funnel', `--https=${httpsPort}`, `http://127.0.0.1:${this.port}`], { windowsHide: true });
      const timer = setTimeout(() => reject(new Error('Tailscale Funnel 주소를 받지 못했습니다(시간 초과).')), 40000);
      let buf = '';
      const onData = (d) => {
        const s = d.toString();
        buf += s;
        for (const line of s.split('\n')) if (line.trim()) this.log?.(line.trim());
        const need = buf.match(/https:\/\/login\.tailscale\.com\/f\/funnel[^\s]*/);
        if (need && !this.url) {
          clearTimeout(timer);
          this.stop();
          reject(Object.assign(new Error('이 tailnet에서 Funnel이 꺼져 있습니다. 아래 주소에서 한 번만 허용한 뒤 다시 시도하세요:\n' + need[0]), { link: need[0] }));
          return;
        }
        if (!this.url && (/Available on the internet/i.test(buf) || buf.includes(dns))) {
          this.url = `https://${dns}${httpsPort === 443 ? '' : ':' + httpsPort}`;
          clearTimeout(timer);
          resolve(this.url);
        }
        if (/error|failed|not allowed/i.test(s) && !this.url) {
          clearTimeout(timer);
          this.stop();
          reject(new Error('Tailscale Funnel 실패: ' + s.trim().slice(0, 300)));
        }
      };
      this.proc.stdout.on('data', onData);
      this.proc.stderr.on('data', onData);
      this.proc.on('error', (e) => { clearTimeout(timer); reject(e); });
      this.proc.on('exit', (code) => {
        clearTimeout(timer);
        if (!this.url) reject(new Error('tailscale funnel이 종료되었습니다 (코드 ' + code + ')\n' + buf.trim().slice(-300)));
        else this.onExit?.(code);
      });
    });
  }

  stop() {
    const p = this.proc;
    this.proc = null;
    this.url = null;
    if (!p) return;
    try { p.stdin?.end(); } catch {}
    try { p.kill(); } catch {}
  }
}

async function publicIp() {
  for (const u of ['https://api.ipify.org', 'https://ifconfig.me/ip']) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(5000) });
      const t = (await r.text()).trim();
      if (/^\d+\.\d+\.\d+\.\d+$/.test(t)) return t;
    } catch {}
  }
  return null;
}

module.exports = { QuickTunnel, TailscaleFunnel, Upnp, lanAddresses, publicIp };
