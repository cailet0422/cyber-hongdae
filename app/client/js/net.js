// WebSocket 연결 + 서버 시계 동기화
export class Net extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.offset = 0; // serverTime - localTime
    this.rtt = 0;
    this._samples = [];
  }

  connect(hello) {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws = ws;
      let welcomed = false;
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', ...hello }));
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'pong') return this._pong(m);
        if (m.t === 'welcome') {
          welcomed = true;
          this.offset = m.serverTime - Date.now();
          this._pingLoop();
          resolve(m);
          return;
        }
        if (m.t === 'denied') { reject(Object.assign(new Error(m.reason), { password: m.password })); return; }
        this.dispatchEvent(new CustomEvent('msg', { detail: m }));
      };
      ws.onclose = (ev) => {
        clearInterval(this._pingT);
        if (!welcomed) reject(new Error('서버에 연결할 수 없습니다.'));
        else this.dispatchEvent(new CustomEvent('close', { detail: ev }));
      };
      ws.onerror = () => {};
    });
  }

  send(obj) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj)); }
  now() { return Date.now() + this.offset; }

  _pingLoop() {
    const ping = () => this.send({ t: 'ping', c: performance.now() });
    ping();
    setTimeout(ping, 500);
    setTimeout(ping, 1200);
    this._pingT = setInterval(ping, 10000);
  }
  _pong(m) {
    const now = performance.now();
    const rtt = now - m.c;
    // 왕복 시간이 짧은 샘플일수록 정확 → 최근 8개 중 RTT 최소 샘플 사용
    const off = m.s + rtt / 2 - (Date.now() - (performance.now() - now));
    this._samples.push({ rtt, off });
    if (this._samples.length > 8) this._samples.shift();
    const best = this._samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.offset = best.off;
    this.rtt = best.rtt;
  }
}

// 로컬 설정 (브라우저 저장소, 실패해도 기본값으로 동작)
const DEFAULTS = {
  char: null, volume: 0.8, lobbyVolume: 0.35, subSize: 1, sens: 1, quality: 'mid', maxAvatars: 40,
  showNames: true, showBubbles: true, showSubs: true, clientId: null, stickColor: 0, firstPerson: false,
};
export const prefs = (() => {
  let data = { ...DEFAULTS };
  try { Object.assign(data, JSON.parse(localStorage.getItem('cyberhongdae') || '{}')); } catch {}
  if (!data.clientId) data.clientId = (crypto.randomUUID?.() || String(Math.random()).slice(2)) + '';
  const save = () => { try { localStorage.setItem('cyberhongdae', JSON.stringify(data)); } catch {} };
  save();
  return new Proxy(data, { set(t, k, v) { t[k] = v; save(); return true; } });
})();
