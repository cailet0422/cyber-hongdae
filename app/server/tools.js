// 외부 실행 파일 경로 (tools/bin 우선, 없으면 PATH)
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CANDIDATE_DIRS = [
  process.env.CYBERHONGDAE_TOOLS,
  path.resolve(__dirname, '..', '..', 'tools', 'bin'),
  path.resolve(__dirname, '..', 'tools', 'bin'),
  process.resourcesPath ? path.join(process.resourcesPath, 'tools', 'bin') : null,
].filter(Boolean);

function bin(name, extraDirs = []) {
  const exe = process.platform === 'win32' ? name + '.exe' : name;
  for (const d of [...CANDIDATE_DIRS, ...extraDirs]) {
    const p = path.join(d, exe);
    if (fs.existsSync(p)) return p;
  }
  return name;
}

const TOOLS = {
  get ffmpeg() { return bin('ffmpeg'); },
  get ffprobe() { return bin('ffprobe'); },
  get ytdlp() { return bin('yt-dlp'); },
  get cloudflared() { return bin('cloudflared'); },
  // Tailscale은 시스템에 설치되는 프로그램이므로 기본 설치 위치도 찾아본다
  get tailscale() {
    return bin('tailscale', process.platform === 'win32'
      ? ['C:\\Program Files\\Tailscale', 'C:\\Program Files (x86)\\Tailscale']
      : ['/usr/bin', '/usr/local/bin', '/Applications/Tailscale.app/Contents/MacOS']);
  },
};

// 프로세스 실행 → { code, stdout, stderr }
function run(cmd, args, { timeout = 0, onLine, onErrLine, signal } = {}) {
  return new Promise((resolve) => {
    let out = '', err = '';
    let p;
    try {
      p = spawn(cmd, args, { windowsHide: true });
    } catch (e) {
      return resolve({ code: -1, stdout: '', stderr: String(e) });
    }
    let timer = null;
    if (timeout) timer = setTimeout(() => p.kill(), timeout);
    if (signal) signal.addEventListener('abort', () => p.kill(), { once: true });
    const lines = (cb) => {
      let buf = '';
      return (d) => {
        buf += d.toString();
        const parts = buf.split(/\r?\n|\r/);
        buf = parts.pop();
        if (cb) parts.forEach(cb);
      };
    };
    const lo = lines(onLine), le = lines(onErrLine);
    p.stdout.on('data', (d) => { out += d; lo(d); });
    p.stderr.on('data', (d) => { err += d; if (err.length > 200000) err = err.slice(-100000); le(d); });
    p.on('error', (e) => { err += String(e); });
    p.on('close', (code) => { if (timer) clearTimeout(timer); resolve({ code, stdout: out, stderr: err }); });
  });
}

let nvencChecked = null;
async function hasNvenc() {
  if (nvencChecked !== null) return nvencChecked;
  const r = await run(TOOLS.ffmpeg, ['-hide_banner', '-f', 'lavfi', '-i', 'color=black:s=256x256:d=0.1', '-c:v', 'h264_nvenc', '-f', 'null', '-'], { timeout: 15000 });
  nvencChecked = r.code === 0;
  return nvencChecked;
}

module.exports = { TOOLS, run, hasNvenc };
