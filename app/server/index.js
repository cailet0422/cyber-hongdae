// 사이버 홍대입구 서버 코어 (Electron 대시보드와 standalone 양쪽에서 사용)
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { Readable } = require('stream');
const express = require('express');
const { WebSocketServer } = require('ws');
const { MediaManager, UA } = require('./media');
const { Playback } = require('./playback');
const { QuickTunnel, TailscaleFunnel, Upnp, lanAddresses } = require('./tunnel');

const APP_DIR = path.resolve(__dirname, '..');
const CLIENT_DIR = path.join(APP_DIR, 'client');
const NM = path.join(APP_DIR, 'node_modules');
const VERSION = require('../package.json').version;

const CHARACTERS = [
  { id: 'yui', name: '유이', color: '#ff4848' },
  { id: 'mio', name: '미오', color: '#4d7cff' },
  { id: 'ritsu', name: '리츠', color: '#ffd23f' },
  { id: 'mugi', name: '무기', color: '#ff7eb6' },
  { id: 'azusa', name: '아즈사', color: '#3fd46e' },
];

const DEFAULT_CONFIG = {
  port: 7777,
  exposure: 'tunnel', // tunnel(Cloudflare) | tailscale(Funnel) | upnp | lan
  serverName: '사이버 홍대입구',
  password: '',
  maxUsers: 150,
  names: ['유이', '미오', '리츠', '무기', '아즈사', '우이', '노도카', '준', '사와코', '스미레', '나오'],
  chat: { slowMode: 0, maxLen: 200, enabled: true },
  customModels: { enabled: true, maxMB: 60 },
  media: { maxHeight: 1080, ytSubs: true, subLangs: 'ko.*,ko,en.*,en,ja', prefetch: 3 },
  sign4: {
    hall: '4관', floor: '10층', autoTitle: true, title: '', message: '관람고객님은 지금 입장하시기 바랍니다.',
    messageEn: 'Please enter the Screen 4', showClock: true, bg: 'default', color: '#ffffff',
  },
  lobby: { itemId: null, volume: 0.25, startedAt: Date.now() },
  stickColors: [
    { id: 'yui', name: '유이', color: '#ff2a2a' },
    { id: 'mio', name: '미오', color: '#2f6bff' },
    { id: 'ritsu', name: '리츠', color: '#ffd400' },
    { id: 'mugi', name: '무기', color: '#ff69b4' },
    { id: 'azusa', name: '아즈사', color: '#22d45a' },
  ],
};

function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) ? deepMerge(a[k], v) : v;
  }
  return out;
}

class CinemaServer extends EventEmitter {
  constructor({ dataDir }) {
    super();
    this.dataDir = dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    this.config = deepMerge(DEFAULT_CONFIG, readJson(path.join(dataDir, 'config.json'), {}));
    const OLD_STICKS = '#ff69b4,#2f6bff,#ffd400,#9be8ff,#ff2a2a';
    if ((this.config.stickColors || []).map((x) => x.color).join(',') === OLD_STICKS) this.config.stickColors = DEFAULT_CONFIG.stickColors;
    this.bans = readJson(path.join(dataDir, 'bans.json'), []);
    this.avatarDir = path.join(dataDir, 'avatars');
    fs.mkdirSync(this.avatarDir, { recursive: true });
    this.media = new MediaManager({ dataDir, settings: this.config.media });
    this.playback = new Playback(this.media);
    this.users = new Map();
    this.seats = new Map(); // seatId → userId
    this.chatLog = [];
    this.nextId = 1;
    this.running = false;
    this.publicUrl = null;
    this.status = 'stopped';
    this.logs = [];

    this.playback.on('change', (snap) => { this.broadcast({ t: 'pb', d: snap }); this.emit('playback', snap); this._signUpdate(); });
    this.media.on('change', () => { this.emit('media', this.mediaState()); this._lobbyCheck(); });
    this.media.on('item', (it) => this.emit('item', it));
    // 준비 진행률을 클라이언트 스크린에 표시
    this.media.on('item', (it) => {
      if (it.id === this.playback.itemId && it.status !== 'ready') this.broadcastThrottled('pbprep', { t: 'pb', d: this.playback.snapshot() }, 1000);
    });
  }

  // ---------------------------------------------------------------- 설정
  saveConfig() { fs.writeFileSync(path.join(this.dataDir, 'config.json'), JSON.stringify(this.config, null, 2)); }
  setConfig(patch) {
    this.config = deepMerge(this.config, patch);
    this.media.settings = this.config.media;
    this.saveConfig();
    this.broadcast({ t: 'cfg', d: this.publicConfig() });
    this.emit('config', this.config);
    return this.config;
  }
  publicConfig() {
    const c = this.config;
    return { serverName: c.serverName, sign4: this.sign4State(), lobby: this.lobbyState(), stickColors: c.stickColors, characters: CHARACTERS, chat: { enabled: c.chat.enabled, slowMode: c.chat.slowMode, maxLen: c.chat.maxLen }, customModels: c.customModels };
  }
  sign4State() {
    const s = this.config.sign4;
    const title = s.autoTitle ? (this.playback.current()?.title || s.title || '') : s.title;
    return { ...s, title, bgUrl: s.bg && s.bg !== 'default' && fs.existsSync(s.bg) ? '/custom/sign4bg?v=' + (fs.statSync(s.bg).mtimeMs | 0) : null, nowPlaying: this.playback.snapshot().status === 'playing' };
  }
  _signUpdate() {
    const st = this.sign4State();
    const key = st.title + '|' + st.nowPlaying;
    if (key !== this._lastSignKey) { this._lastSignKey = key; this.broadcast({ t: 'cfg', d: this.publicConfig() }); }
  }

  // ---------------------------------------------------------------- 로비 전광판
  lobbyItems() { return [...this.media.items.values()].filter((i) => i.role === 'lobby').map((i) => this.media.public(i)); }
  lobbyState() {
    const it = this.config.lobby.itemId ? this.media.get(this.config.lobby.itemId) : null;
    return { item: it ? this.media.playInfo(it) : null, volume: this.config.lobby.volume, startedAt: this.config.lobby.startedAt };
  }
  setLobbyItem(id) {
    this.config.lobby.itemId = id || null;
    this.config.lobby.startedAt = Date.now();
    this.saveConfig();
    this.broadcast({ t: 'cfg', d: this.publicConfig() });
    this.emit('media', this.mediaState());
  }
  _lobbyCheck() {
    const id = this.config.lobby.itemId;
    const it = id && this.media.get(id);
    const ready = !!(it && it.status === 'ready');
    if (id && !it) { this.config.lobby.itemId = null; this.saveConfig(); }
    if (ready !== this._lobbyReady) { this._lobbyReady = ready; this.broadcast({ t: 'cfg', d: this.publicConfig() }); }
  }
  mediaState() {
    return { playlist: this.media.list(), lobby: this.lobbyItems(), lobbyItemId: this.config.lobby.itemId, cacheBytes: this._cacheBytes() };
  }
  _cacheBytes() {
    if (!this._cb || Date.now() - this._cb.t > 5000) this._cb = { t: Date.now(), v: this.media.cacheSize() };
    return this._cb.v;
  }

  // ---------------------------------------------------------------- HTTP
  _app() {
    const app = express();
    app.disable('x-powered-by');
    app.use((req, res, next) => { res.setHeader('Cache-Control', 'no-cache'); next(); });
    app.use('/vendor/three', express.static(path.join(NM, 'three'), { maxAge: '7d' }));
    app.use('/vendor/hls', express.static(path.join(NM, 'hls.js', 'dist'), { maxAge: '7d' }));
    app.use('/vendor/bvh', express.static(path.join(NM, 'three-mesh-bvh'), { maxAge: '7d' }));
    app.use('/vendor/vrm', express.static(path.join(NM, '@pixiv', 'three-vrm', 'lib'), { maxAge: '7d' }));
    app.use('/assets', express.static(path.join(CLIENT_DIR, 'assets'), { maxAge: '1h' }));
    app.use(express.static(CLIENT_DIR));
    if (this.adminHook) this.adminHook(app);

    // ---- 커스텀 3D 모델 업로드 (접속 중인 사용자만, 내용 해시로 저장)
    // 용량 제한은 대시보드 설정을 요청마다 반영 (본문을 읽기 전에 Content-Length로 먼저 거른다)
    const tooBig = (req, res, next) => {
      const max = (this.config.customModels.maxMB || 60) * 1048576;
      if (+req.headers['content-length'] > max) return res.status(413).json({ error: `파일이 너무 큽니다 (최대 ${this.config.customModels.maxMB}MB)` });
      next();
    };
    app.post('/api/avatar', tooBig, express.raw({ type: () => true, limit: '500mb' }), (req, res) => {
      if (!this.config.customModels.enabled) return res.status(403).json({ error: '이 서버는 커스텀 모델을 허용하지 않습니다' });
      const u = [...this.users.values()].find((x) => x.uploadToken && x.uploadToken === req.headers['x-upload-token']);
      if (!u) return res.status(401).json({ error: '접속 정보가 없습니다. 새로고침 후 다시 시도하세요' });
      const name = decodeURIComponent(String(req.headers['x-file-name'] || 'model'));
      const ext = (name.split('.').pop() || '').toLowerCase();
      if (!MODEL_EXTS.includes(ext)) return res.status(400).json({ error: '지원하지 않는 형식입니다: .' + ext });
      const buf = req.body;
      if (!Buffer.isBuffer(buf) || buf.length < 16) return res.status(400).json({ error: '빈 파일입니다' });
      if (buf.length > (this.config.customModels.maxMB || 60) * 1048576) return res.status(413).json({ error: `파일이 너무 큽니다 (최대 ${this.config.customModels.maxMB}MB)` });
      const id = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32);
      const file = path.join(this.avatarDir, `${id}.${ext}`);
      if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
      else fs.utimesSync(file, new Date(), new Date());
      this._pruneAvatars();
      this.log(`모델 업로드: ${u.nick} ${name} (${(buf.length / 1048576).toFixed(1)}MB)`);
      res.json({ id, ext });
    });
    app.get('/avatars/:file', (req, res) => {
      const m = String(req.params.file).match(/^([0-9a-f]{32})\.([a-z0-9]{2,4})$/);
      if (!m || !MODEL_EXTS.includes(m[2])) return res.status(404).end();
      const f = path.join(this.avatarDir, req.params.file);
      if (!fs.existsSync(f)) return res.status(404).end();
      res.sendFile(f, { headers: { 'Cache-Control': 'public, max-age=604800, immutable', 'Content-Type': 'application/octet-stream' } });
    });
    app.use((err, req, res, next) => {
      if (err?.type === 'entity.too.large') return res.status(413).json({ error: `파일이 너무 큽니다 (최대 ${this.config.customModels.maxMB}MB)` });
      next(err);
    });
    app.get('/api/info', (req, res) => res.json({
      name: this.config.serverName, needPassword: !!this.config.password, characters: CHARACTERS,
      online: this.users.size, max: this.config.maxUsers, version: VERSION, assets: installedAssets(),
      customModels: this.config.customModels,
    }));
    app.get('/subs/:sid.json', (req, res) => {
      const p = this.media.subPath(req.params.sid);
      if (!p || !fs.existsSync(p)) return res.status(404).end();
      res.type('json').sendFile(p);
    });
    app.get('/custom/sign4bg', (req, res) => {
      const b = this.config.sign4.bg;
      if (!b || b === 'default' || !fs.existsSync(b)) return res.status(404).end();
      res.sendFile(b);
    });
    // 로컬/캐시 파일 (Range 지원)
    app.get('/m/:id/file', (req, res) => {
      const it = this.media.get(req.params.id);
      if (!it?.localPath) return res.status(404).end();
      res.sendFile(it.localPath, { acceptRanges: true, cacheControl: false, headers: { 'Cache-Control': 'private, max-age=3600' } });
    });
    // 원격 직접 링크 프록시 (CORS 회피 + Range 전달)
    app.get('/m/:id/r', async (req, res) => {
      const it = this.media.get(req.params.id);
      if (!it) return res.status(404).end();
      const url = it.remote?.url || (it.kind === 'direct' ? it.source : null);
      if (!url) return res.status(404).end();
      await proxy(req, res, url, it.remote?.headers || { 'User-Agent': UA });
    });
    // 영상/음성 분리 HLS(유튜브 등)를 하나로 묶는 마스터 재생목록
    app.get('/m/:id/master.m3u8', (req, res) => {
      const it = this.media.get(req.params.id);
      const r = it?.remote;
      if (!r?.master) return res.status(404).end();
      const res_ = r.width && r.height ? `,RESOLUTION=${r.width}x${r.height}` : '';
      res.type('application/vnd.apple.mpegurl').send([
        '#EXTM3U',
        `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="audio",DEFAULT=YES,AUTOSELECT=YES,URI="${this._hlsUrl(it.id, r.audio)}"`,
        `#EXT-X-STREAM-INF:BANDWIDTH=${r.bw || 2000000}${res_},AUDIO="aud"`,
        this._hlsUrl(it.id, r.video),
        '',
      ].join('\n'));
    });
    // HLS 프록시 (재생목록 URI 재작성, 서명 검증)
    app.get('/m/:id/h/:name', async (req, res) => {
      const it = this.media.get(req.params.id);
      const u = req.query.u ? Buffer.from(String(req.query.u), 'base64url').toString() : null;
      if (!it || !u || this.media.sign(it.id, u) !== req.query.s) return res.status(403).end();
      const headers = it.remote?.headers || { 'User-Agent': UA };
      try {
        const r = await fetch(u, { headers: { ...headers, ...(req.headers.range ? { Range: req.headers.range } : {}) } });
        const ct = r.headers.get('content-type') || '';
        const isList = /mpegurl/i.test(ct) || /\.m3u8(\?|$)/i.test(u) || req.params.name === 'index.m3u8';
        if (isList) {
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.subarray(0, 7).toString() === '#EXTM3U') {
            res.type('application/vnd.apple.mpegurl').send(this._rewriteM3u8(it.id, buf.toString('utf8'), r.url || u));
            return;
          }
          res.status(r.status);
          if (ct) res.setHeader('content-type', ct);
          res.send(buf);
          return;
        }
        res.status(r.status);
        for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (r.headers.get(h)) res.setHeader(h, r.headers.get(h));
        if (r.body) Readable.fromWeb(r.body).on('error', () => res.end()).pipe(res);
        else res.end();
      } catch (e) {
        if (!res.headersSent) res.status(502).end();
      }
    });
    return app;
  }

  _hlsUrl(id, abs, list = true) {
    return `/m/${id}/h/${list ? 'index.m3u8' : 'seg'}?u=${Buffer.from(abs).toString('base64url')}&s=${this.media.sign(id, abs)}`;
  }

  _rewriteM3u8(id, text, base) {
    const wrap = (raw) => {
      const abs = new URL(raw, base).href;
      return this._hlsUrl(id, abs, /\.m3u8(\?|$)/i.test(abs));
    };
    return text.split(/\r?\n/).map((line) => {
      if (!line) return line;
      if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${wrap(u)}"`);
      return wrap(line.trim());
    }).join('\n');
  }

  // ---------------------------------------------------------------- 시작/종료
  async start({ port, exposure } = {}) {
    if (this.running) return this.urls();
    port = port || this.config.port;
    exposure = exposure || this.config.exposure;
    this.config.port = port;
    this.config.exposure = exposure;
    this.saveConfig();
    this._setStatus('starting');
    const app = this._app();
    this.http = http.createServer(app);
    this.wss = new WebSocketServer({ server: this.http, path: '/ws', maxPayload: 16 * 1024 });
    this.wss.on('connection', (ws, req) => this._onConnection(ws, req));
    // 터널 방식은 이 PC 안에서만 받도록 묶어 내 IP/공유기로 직접 들어오는 경로를 막는다
    const host = exposure === 'tunnel' || exposure === 'tailscale' ? '127.0.0.1' : '0.0.0.0';
    await new Promise((res, rej) => {
      this.http.once('error', (e) => rej(e.code === 'EADDRINUSE' ? new Error(`포트 ${port}가 이미 사용 중입니다. 다른 포트를 선택하세요.`) : e));
      this.http.listen(port, host, res);
    });
    this.running = true;
    this.port = port;
    this.exposure = exposure;
    this._tick = setInterval(() => this._flushPositions(), 100);
    this._syncT = setInterval(() => { if (this.playback.playing) this.broadcast({ t: 'pbs', pos: this.playback.position(), serverTime: Date.now(), itemId: this.playback.itemId }); }, 5000);
    this.log(`서버 시작: 포트 ${port}`);
    this.publicUrl = null;
    try {
      if (exposure === 'tunnel') {
        this._setStatus('tunnel');
        this.tunnel = new QuickTunnel(port, (l) => this.log('[cloudflared] ' + l));
        this.tunnel.onExit = () => { if (this.running) { this.log('Cloudflare 터널이 끊어졌습니다. 서버를 다시 열어 주세요.'); this.publicUrl = null; this._setStatus('error'); } };
        this.publicUrl = await this.tunnel.start();
      } else if (exposure === 'tailscale') {
        this._setStatus('tailscale');
        this.tunnel = new TailscaleFunnel(port, (l) => this.log('[tailscale] ' + l));
        this.tunnel.onExit = () => { if (this.running) { this.log('Tailscale Funnel이 종료되었습니다. 서버를 다시 열어 주세요.'); this.publicUrl = null; this._setStatus('error'); } };
        this.publicUrl = await this.tunnel.start();
      } else if (exposure === 'upnp') {
        this._setStatus('upnp');
        this.upnp = new Upnp(port, (l) => this.log(l));
        this.publicUrl = await this.upnp.start();
      }
    } catch (e) {
      this.log('공개 주소 생성 실패: ' + e.message);
      await this.stop();
      throw e;
    }
    this._setStatus('running');
    return this.urls();
  }

  async stop() {
    clearInterval(this._tick);
    clearInterval(this._syncT);
    for (const u of this.users.values()) { try { u.ws.close(1001, 'server closing'); } catch {} }
    this.users.clear();
    this.seats.clear();
    this.tunnel?.stop(); this.tunnel = null;
    this.upnp?.stop(); this.upnp = null;
    if (this.wss) { this.wss.close(); this.wss = null; }
    if (this.http) { await new Promise((r) => { this.http.close(() => r()); setTimeout(r, 1500); this.http.closeAllConnections?.(); }); this.http = null; }
    this.running = false;
    this.publicUrl = null;
    this._setStatus('stopped');
    this.emit('users', []);
    this.log('서버 종료');
  }

  urls() {
    const local = `http://localhost:${this.port || this.config.port}`;
    const lan = this.exposure === 'tunnel' || this.exposure === 'tailscale' ? [] : lanAddresses().map((a) => `http://${a.address}:${this.port}`);
    return { public: this.publicUrl, local, lan, status: this.status, exposure: this.exposure };
  }
  _setStatus(s) { this.status = s; this.emit('status', { status: s, urls: this.running ? this.urls() : null }); }
  log(msg) {
    const line = `[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${msg}`;
    this.logs.push(line);
    if (this.logs.length > 500) this.logs.shift();
    this.emit('log', line);
  }

  // ---------------------------------------------------------------- 접속자
  _ipOf(req) {
    let ip = req.socket.remoteAddress || '';
    const loop = /^(::1|127\.|::ffff:127\.)/.test(ip);
    if (loop && req.headers['cf-connecting-ip']) ip = String(req.headers['cf-connecting-ip']);
    else if (loop && req.headers['x-forwarded-for']) ip = String(req.headers['x-forwarded-for']).split(',')[0].trim();
    return ip.replace(/^::ffff:/, '');
  }

  _isBanned(ip, clientId) {
    return this.bans.find((b) => (b.ip && b.ip === ip) || (b.clientId && clientId && b.clientId === clientId));
  }

  _nickname() {
    const names = this.config.names.length ? this.config.names : DEFAULT_CONFIG.names;
    const used = new Set([...this.users.values()].map((u) => u.nick));
    for (let i = 0; i < 50; i++) {
      const n = names[crypto.randomInt(names.length)] + String(crypto.randomInt(1000, 10000));
      if (!used.has(n)) return n;
    }
    return names[0] + crypto.randomInt(10000, 99999);
  }

  _onConnection(ws, req) {
    const ip = this._ipOf(req);
    let user = null;
    const helloTimer = setTimeout(() => { if (!user) ws.close(4000, 'timeout'); }, 15000);
    ws.on('message', (raw, isBinary) => {
      if (isBinary) return;
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (!user) {
        if (m.t !== 'hello') return;
        clearTimeout(helloTimer);
        const clientId = String(m.clientId || '').slice(0, 64);
        const ban = this._isBanned(ip, clientId);
        if (ban) { ws.send(JSON.stringify({ t: 'denied', reason: '이 서버에서 차단되었습니다.' + (ban.reason ? ' 사유: ' + ban.reason : '') })); return ws.close(4003, 'banned'); }
        if (this.config.password && m.password !== this.config.password) { ws.send(JSON.stringify({ t: 'denied', reason: '입장 비밀번호가 틀렸습니다.', password: true })); return ws.close(4001, 'password'); }
        if (this.users.size >= this.config.maxUsers) { ws.send(JSON.stringify({ t: 'denied', reason: '정원이 가득 찼습니다.' })); return ws.close(4002, 'full'); }
        const char = CHARACTERS.some((c) => c.id === m.char) ? m.char : CHARACTERS[crypto.randomInt(5)].id;
        user = {
          id: this.nextId++, ws, ip, clientId, nick: this._nickname(), char, joinedAt: Date.now(),
          st: [0, 0, 0, 0, 0], seat: null, stick: { on: false, color: 0 }, muted: false, chatTimes: [], dirty: true, emote: null,
          model: null, uploadToken: crypto.randomBytes(16).toString('hex'),
        };
        this.users.set(user.id, user);
        this.send(user, {
          t: 'welcome', id: user.id, nick: user.nick, char: user.char, uploadToken: user.uploadToken,
          users: [...this.users.values()].filter((u) => u !== user).map((u) => this._userPublic(u)),
          pb: this.playback.snapshot(), cfg: this.publicConfig(), chat: this.chatLog.slice(-50), serverTime: Date.now(),
        });
        this.broadcast({ t: 'join', u: this._userPublic(user) }, user);
        this._joinLeave(`${user.nick} 님이 입장했습니다.`);
        this.log(`입장: ${user.nick} (${ip})`);
        this._emitUsers();
        return;
      }
      // 잘못된 메시지 하나로 서버 전체가 멈추지 않도록
      try { this._onMessage(user, m); } catch (e) { this.log(`메시지 처리 오류 (${user.nick}): ${e.message}`); }
    });
    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (!user || !this.users.has(user.id)) return;
      this.users.delete(user.id);
      if (user.seat) this.seats.delete(user.seat);
      this.broadcast({ t: 'leave', id: user.id });
      this._joinLeave(`${user.nick} 님이 퇴장했습니다.`);
      this.log(`퇴장: ${user.nick}`);
      this._emitUsers();
    });
    ws.on('error', () => {});
  }

  _userPublic(u) { return { id: u.id, nick: u.nick, char: u.char, st: u.st, seat: u.seat, stick: u.stick, emote: u.emote, model: u.model }; }

  _onMessage(u, m) {
    switch (m.t) {
      case 'ping': return this.send(u, { t: 'pong', c: m.c, s: Date.now() });
      case 'p': {
        if (!Array.isArray(m.d) || m.d.length < 5) return;
        const d = m.d.map((x) => (Number.isFinite(+x) ? +x : 0));
        u.st = [clamp(d[0], -50, 100), clamp(d[1], -10, 20), clamp(d[2], -50, 120), clamp(d[3], -10, 10), clamp(d[4] | 0, 0, 31)];
        u.dirty = true;
        return;
      }
      case 'chat': {
        if (!this.config.chat.enabled) return this.send(u, { t: 'sys', text: '관리자가 채팅을 잠시 막았습니다.' });
        if (u.muted) return this.send(u, { t: 'sys', text: '채팅이 금지된 상태입니다.' });
        const text = String(m.text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, this.config.chat.maxLen);
        if (!text) return;
        const now = Date.now();
        const slow = (this.config.chat.slowMode || 0) * 1000;
        u.chatTimes = u.chatTimes.filter((t) => now - t < 5000);
        if (u.chatTimes.length >= 5 || (slow && u.lastChat && now - u.lastChat < slow)) return this.send(u, { t: 'sys', text: slow ? `슬로우 모드: ${this.config.chat.slowMode}초에 한 번 보낼 수 있어요.` : '채팅을 너무 빨리 보내고 있어요.' });
        u.chatTimes.push(now);
        u.lastChat = now;
        const msg = { t: 'chat', id: u.id, nick: u.nick, char: u.char, text, ts: now };
        this._pushChat(msg);
        return this.broadcast(msg);
      }
      case 'char': {
        if (!CHARACTERS.some((c) => c.id === m.char)) return;
        u.char = m.char;
        this.broadcast({ t: 'char', id: u.id, char: u.char });
        return this._emitUsers();
      }
      case 'model': {
        const mm = m_model(m.model);
        if (mm && !this.config.customModels.enabled) return this.send(u, { t: 'modelfail', reason: '이 서버는 커스텀 모델을 허용하지 않습니다' });
        if (mm && !fs.existsSync(path.join(this.avatarDir, `${mm.id}.${mm.ext}`))) return this.send(u, { t: 'modelfail', reason: '서버에 모델 파일이 없습니다. 다시 올려 주세요' });
        u.model = mm;
        this.broadcast({ t: 'model', id: u.id, model: mm });
        return this._emitUsers();
      }
      case 'emote': {
        const e = m.e == null ? null : String(m.e).slice(0, 24);
        u.emote = e;
        return this.broadcast({ t: 'emote', id: u.id, e }, u);
      }
      case 'stick': {
        u.stick = { on: !!m.on, color: clamp(m.color | 0, 0, 4), wave: !!m.wave };
        return this.broadcast({ t: 'stick', id: u.id, s: u.stick }, u);
      }
      case 'sit': {
        const seat = String(m.seat || '');
        if (!/^[A-K]\d{1,2}$/.test(seat)) return;
        const owner = this.seats.get(seat);
        if (owner && owner !== u.id && this.users.has(owner)) return this.send(u, { t: 'sitfail', seat });
        if (u.seat) this.seats.delete(u.seat);
        u.seat = seat;
        this.seats.set(seat, u.id);
        return this.broadcast({ t: 'seat', id: u.id, seat });
      }
      case 'stand': {
        if (u.seat) this.seats.delete(u.seat);
        u.seat = null;
        return this.broadcast({ t: 'seat', id: u.id, seat: null });
      }
      case 'ended': return this.playback.reportEnded(String(m.itemId));
      case 'duration': return this.playback.reportDuration(String(m.itemId), +m.d);
    }
  }

  _flushPositions() {
    const d = [];
    for (const u of this.users.values()) {
      if (!u.dirty) continue;
      u.dirty = false;
      d.push([u.id, ...u.st.map((x, i) => (i < 4 ? Math.round(x * 100) / 100 : x))]);
    }
    if (d.length) this.broadcast({ t: 'P', d });
  }

  _pushChat(msg) {
    this.chatLog.push(msg);
    if (this.chatLog.length > 300) this.chatLog.shift();
    this.emit('chat', msg);
  }
  // 입장/퇴장 알림: 기록에 남기지 않고, 인원이 많으면 생략 (관리자 화면에는 항상 표시)
  _joinLeave(text) {
    const msg = { t: 'sys', text, ts: Date.now() };
    this.emit('chat', msg);
    if (this.users.size < 50) this.broadcast(msg);
  }
  _system(text) { const msg = { t: 'sys', text, ts: Date.now() }; this._pushChat(msg); this.broadcast(msg); }
  _emitUsers() { this.emit('users', this.userList()); }

  send(u, obj) { if (u.ws.readyState === 1) u.ws.send(JSON.stringify(obj)); }
  broadcast(obj, except) {
    const s = JSON.stringify(obj);
    for (const u of this.users.values()) if (u !== except && u.ws.readyState === 1 && u.ws.bufferedAmount < 2_000_000) u.ws.send(s);
  }
  broadcastThrottled(key, obj, ms) {
    this._thr = this._thr || {};
    const now = Date.now();
    if (this._thr[key] && now - this._thr[key] < ms) return;
    this._thr[key] = now;
    this.broadcast(obj);
  }

  // ---------------------------------------------------------------- 관리자 기능
  userList() {
    return [...this.users.values()].map((u) => ({ id: u.id, nick: u.nick, char: u.char, ip: u.ip, joinedAt: u.joinedAt, seat: u.seat, muted: u.muted, clientId: u.clientId, model: u.model }));
  }
  // 부적절한 모델을 기본 캐릭터로 되돌림
  resetModel(id) {
    const u = this.users.get(+id);
    if (!u || !u.model) return false;
    u.model = null;
    this.broadcast({ t: 'model', id: u.id, model: null });
    this.send(u, { t: 'modelreset', reason: '관리자가 커스텀 모델을 기본 캐릭터로 되돌렸습니다.' });
    this.log(`모델 초기화: ${u.nick}`);
    this._emitUsers();
    return true;
  }
  // 오래된 모델 파일 정리 (총 2GB 초과 시 오래 안 쓴 것부터)
  _pruneAvatars(maxBytes = 2 * 1024 ** 3) {
    try {
      const inUse = new Set([...this.users.values()].filter((x) => x.model).map((x) => `${x.model.id}.${x.model.ext}`));
      const files = fs.readdirSync(this.avatarDir).map((f) => ({ f, st: fs.statSync(path.join(this.avatarDir, f)) })).sort((a, b) => a.st.mtimeMs - b.st.mtimeMs);
      let total = files.reduce((n, x) => n + x.st.size, 0);
      for (const x of files) {
        if (total <= maxBytes) break;
        if (inUse.has(x.f)) continue;
        fs.rmSync(path.join(this.avatarDir, x.f), { force: true });
        total -= x.st.size;
      }
    } catch {}
  }
  kick(id, reason = '') {
    const u = this.users.get(+id);
    if (!u) return false;
    this.send(u, { t: 'kicked', reason: reason || '관리자에 의해 퇴장되었습니다.' });
    setTimeout(() => { try { u.ws.close(4004, 'kicked'); } catch {} }, 200);
    this.log(`강퇴: ${u.nick}`);
    return true;
  }
  ban(id, reason = '') {
    const u = this.users.get(+id);
    if (!u) return false;
    this.bans.push({ id: crypto.randomBytes(4).toString('hex'), ip: u.ip, clientId: u.clientId, nick: u.nick, reason, at: Date.now() });
    this._saveBans();
    this.send(u, { t: 'kicked', reason: '이 서버에서 차단되었습니다.' + (reason ? ' 사유: ' + reason : '') });
    setTimeout(() => { try { u.ws.close(4003, 'banned'); } catch {} }, 200);
    this.log(`밴: ${u.nick} (${u.ip})`);
    this.emit('bans', this.bans);
    return true;
  }
  unban(banId) { this.bans = this.bans.filter((b) => b.id !== banId); this._saveBans(); this.emit('bans', this.bans); }
  _saveBans() { fs.writeFileSync(path.join(this.dataDir, 'bans.json'), JSON.stringify(this.bans, null, 1)); }
  mute(id, on) {
    const u = this.users.get(+id);
    if (!u) return;
    u.muted = !!on;
    this.send(u, { t: 'sys', text: on ? '관리자가 채팅을 금지했습니다.' : '채팅 금지가 해제되었습니다.' });
    this._emitUsers();
  }
  notice(text) {
    text = String(text || '').trim().slice(0, 300);
    if (!text) return;
    const msg = { t: 'notice', text, ts: Date.now() };
    this._pushChat(msg);
    this.broadcast(msg);
  }
  clearChat() { this.chatLog = []; this.broadcast({ t: 'chatclear' }); this.emit('chatclear'); }
}

async function proxy(req, res, url, headers) {
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  try {
    const h = { ...headers };
    if (req.headers.range) h.Range = req.headers.range;
    const r = await fetch(url, { headers: h, redirect: 'follow', signal: ac.signal });
    res.status(r.status);
    for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
      const v = r.headers.get(k);
      if (v) res.setHeader(k, v);
    }
    if (!r.headers.get('accept-ranges')) res.setHeader('accept-ranges', 'bytes');
    if (!r.body) return res.end();
    Readable.fromWeb(r.body).on('error', () => res.end()).pipe(res);
  } catch (e) {
    if (!res.headersSent) res.status(502).end();
    else res.end();
  }
}

// 사용자가 직접 넣은 모델 팩(PMD)/포즈(VPD) 확인 — 없으면 클라이언트가 오리지널 아바타를 사용
function installedAssets() {
  const ids = CHARACTERS.map((c) => c.id);
  return {
    models: ids.filter((id) => fs.existsSync(path.join(CLIENT_DIR, 'assets', 'models', id, 'model.pmd'))),
    poses: ids.filter((id) => fs.existsSync(path.join(CLIENT_DIR, 'assets', 'poses', id + '.vpd'))),
  };
}

const MODEL_EXTS = ['vrm', 'glb', 'gltf', 'fbx', 'obj', 'pmx', 'pmd', 'dae', '3ds', 'stl', 'ply', 'zip'];
// 클라이언트가 보낸 모델 정보 검증
function m_model(m) {
  if (!m || typeof m !== 'object') return null;
  const id = String(m.id || '');
  const ext = String(m.ext || '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(id) || !MODEL_EXTS.includes(ext)) return null;
  return {
    id, ext,
    name: String(m.name || '').replace(/[\u0000-\u001f]/g, '').slice(0, 60),
    height: Math.max(0.4, Math.min(3, +m.height || 1.6)),
    flip: !!m.flip,
  };
}

function readJson(p, def) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return def; } }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

module.exports = { CinemaServer, CHARACTERS, DEFAULT_CONFIG };
