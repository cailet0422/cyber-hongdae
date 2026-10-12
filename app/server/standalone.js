// GUI 없이 서버만 실행 (헤드리스/테스트용)
//   node server/standalone.js [--port 7777] [--expose tunnel|upnp|lan] [--admin-token TOKEN]
// --admin-token 을 주면 이 PC(localhost)에서만 웹 대시보드(http://localhost:포트/admin?token=TOKEN)와
// POST /admin/rpc 를 쓸 수 있다. 외부(터널 포함)에서 온 요청은 거부한다.
const path = require('path');
const fs = require('fs');
const express = require('express');
const QRCode = require('qrcode');
const { CinemaServer } = require('./index');
const { makeAdminApi, ADMIN_EVENTS } = require('./admin-api');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const token = opt('admin-token', process.env.CYBER_ADMIN_TOKEN || '');
const DASH = path.resolve(__dirname, '..', 'dashboard', 'renderer');

const server = new CinemaServer({ dataDir: path.resolve(__dirname, '..', 'data') });
server.on('log', (l) => console.log(l));
const api = makeAdminApi(server, {
  qr: (text) => QRCode.toDataURL(String(text), { margin: 1, width: 360 }),
  copy: () => null,
  openExternal: () => null,
  openDataDir: () => null,
  // 웹 모드에서는 파일 대화상자 대신 경로를 직접 입력받는다 (shim.js에서 처리)
  pickFiles: () => [],
  updateState: () => ({ status: 'dev', version: require('../package.json').version }),
  checkUpdate: () => null,
  setAutoUpdate: () => null,
  installUpdate: () => false,
  pickFolder: () => null,
});

if (token) {
  const local = (req) => /^(::1|127\.|::ffff:127\.)/.test(req.socket.remoteAddress || '') && !req.headers['cf-connecting-ip'] && !req.headers['x-forwarded-for'];
  const authed = (req) => local(req) && (req.headers['x-admin-token'] === token || req.query.token === token);
  server.adminHook = (app) => {
    app.post('/admin/rpc', express.json({ limit: '1mb' }), async (req, res) => {
      if (!authed(req)) return res.status(403).end();
      const fn = api[req.body?.m];
      if (!fn) return res.status(404).json({ error: 'unknown method' });
      try { res.json({ ok: true, r: (await fn(...(req.body.a || []))) ?? null }); }
      catch (e) { res.status(500).json({ error: e.message }); }
    });
    // 서버 이벤트 스트림 (SSE)
    app.get('/admin/events', (req, res) => {
      if (!authed(req)) return res.status(403).end();
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      const subs = ADMIN_EVENTS.map((ev) => { const f = (d) => res.write(`data: ${JSON.stringify([ev, d ?? null])}\n\n`); server.on(ev, f); return [ev, f]; });
      const ka = setInterval(() => res.write(': ka\n\n'), 20000);
      req.on('close', () => { clearInterval(ka); subs.forEach(([ev, f]) => server.off(ev, f)); });
    });
    app.get('/admin', (req, res) => {
      if (!authed(req)) return res.status(403).send('forbidden');
      const html = fs.readFileSync(path.join(DASH, 'index.html'), 'utf8')
        .replace('<script src="app.js"></script>', `<script>window.__ADMIN_TOKEN=${JSON.stringify(token)}</script><script src="/admin/shim.js"></script><script src="/admin/app.js"></script>`)
        .replace('href="style.css"', 'href="/admin/style.css"')
        .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
      res.type('html').send(html);
    });
    app.get('/admin/shim.js', (req, res) => res.type('js').send(SHIM));
    app.use('/admin', (req, res, next) => (local(req) ? next() : res.status(403).end()), express.static(DASH));
    app.use('/client/assets', express.static(path.resolve(__dirname, '..', 'client', 'assets')));
  };
}

// 브라우저에서 Electron preload의 window.api를 흉내낸다
const SHIM = `
(() => {
  const T = window.__ADMIN_TOKEN;
  const listeners = new Map();
  const es = new EventSource('/admin/events?token=' + encodeURIComponent(T));
  es.onmessage = (e) => { const [ch, d] = JSON.parse(e.data); (listeners.get(ch) || []).forEach((cb) => cb(d)); };
  async function call(m, ...a) {
    if (m === 'pickFiles') { const p = prompt('추가할 파일 경로 (여러 개면 | 로 구분)'); return p ? p.split('|').map((x) => x.trim()) : []; }
    if (m === 'pickFolder') return prompt('추가할 폴더 경로');
    if (m === 'copy') { try { await navigator.clipboard.writeText(a[0]); } catch {} return; }
    if (m === 'openExternal') { window.open(a[0], '_blank'); return; }
    const r = await fetch('/admin/rpc', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': T }, body: JSON.stringify({ m, a }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.status);
    return j.r;
  }
  window.api = { call, on: (ch, cb) => { if (!listeners.has(ch)) listeners.set(ch, []); listeners.get(ch).push(cb); }, pathOf: () => null };
})();`;

server.start({ port: +opt('port', 0) || undefined, exposure: opt('expose', 'lan') })
  .then((u) => { console.log('접속 주소:', u); if (token) console.log(`웹 대시보드: http://localhost:${server.port}/admin?token=${token}`); })
  .catch((e) => { console.error(e.message); process.exit(1); });

process.on('SIGINT', async () => { await server.stop(); process.exit(0); });
module.exports = server;

// 예상치 못한 오류로 서버 전체가 꺼지지 않도록 기록만 남긴다
process.on('uncaughtException', (e) => server.log('예상치 못한 오류: ' + (e?.stack || e)));
process.on('unhandledRejection', (e) => server.log('처리되지 않은 오류: ' + (e?.stack || e)));
