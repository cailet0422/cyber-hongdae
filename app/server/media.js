// 미디어 관리: 재생목록 항목 생성/준비(다운로드·변환)/자막/서빙 정보
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { TOOLS, run, hasNvenc } = require('./tools');
const { parseSubtitle, SUB_EXT } = require('./subtitles');
const { LiveManager, livePlan } = require('./live');

const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'wmv', 'flv', 'ts', 'm2ts', 'mts', 'mpg', 'mpeg', 'ogv', '3gp', 'mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'opus'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
const DIRECT_EXT = ['mp4', 'm4v', 'mov', 'webm', 'ogv', 'mp3', 'm4a', 'ogg', 'opus', 'wav', 'flac', 'mkv'];
const OK_VCODEC = ['h264', 'vp8', 'vp9', 'av1'];
const OK_ACODEC = ['aac', 'mp3', 'opus', 'vorbis', 'flac'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

const uid = () => crypto.randomBytes(6).toString('hex');
const extOf = (p) => (p.split(/[?#]/)[0].split('.').pop() || '').toLowerCase();
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

class MediaManager extends EventEmitter {
  constructor({ dataDir, cacheDir, settings, log }) {
    super();
    this.dataDir = dataDir;
    this.cacheDir = cacheDir || path.join(dataDir, 'cache');
    this.log = log || (() => {});
    this.subDir = path.join(dataDir, 'subs');
    fs.mkdirSync(this.cacheDir, { recursive: true });
    fs.mkdirSync(this.subDir, { recursive: true });
    this.settings = settings; // { maxHeight, ytSubs, subLangs, prefetch, keepCache, directPlay }
    this.items = new Map();
    this.playlist = [];
    this.secret = crypto.randomBytes(16).toString('hex');
    this.jobs = new Map(); // id → AbortController
    this.subJobs = new Map(); // id → AbortController (내장 자막 추출, 파일 전체를 읽으므로 한 번에 하나씩)
    this.subQueue = [];
    this.subRunning = 0;
    this.live = new LiveManager({ dir: path.join(this.cacheDir, 'live'), settings: () => this.settings, log: this.log });
    // 바로 재생하던 원본이 바뀌었거나 사라졌으면 다시 준비 (사라졌으면 '파일을 찾을 수 없습니다'로 표시됨)
    this.live.onStale = (id) => { const it = this.items.get(id); if (it?.status === 'ready' && it.conv) this.retry(id); };
    this.queue = [];
    this.running = 0;
    this.currentIndex = 0;
    this._load();
    // 캐시 폴더가 바뀌었으면(설치판: 설치 폴더 옆) 예전 폴더에 있던 영상을 옮겨 둔다
    const oldCache = path.join(dataDir, 'cache');
    if (path.resolve(oldCache) !== path.resolve(this.cacheDir)) setImmediate(() => this._migrateCache(oldCache));
  }

  // 예전 캐시 폴더(C: 사용자 폴더)의 영상을 새 캐시 폴더로 백그라운드에서 옮긴다.
  // 같은 드라이브면 이름만 바꾸고, 다른 드라이브면 복사한 뒤 원본을 지운다. 중간에 꺼져도 다음 실행 때 이어서 옮김
  async _migrateCache(oldDir) {
    let files = [];
    try { files = fs.readdirSync(oldDir).map((f) => path.join(oldDir, f)).filter((f) => fs.statSync(f).isFile()); } catch { return; }
    if (!files.length) { try { fs.rmdirSync(oldDir); } catch {} return; }
    this.log(`영상 캐시 ${files.length}개를 새 캐시 폴더로 옮기는 중… → ${this.cacheDir}`);
    let moved = 0;
    for (const src of files) {
      const dst = path.join(this.cacheDir, path.basename(src));
      try {
        try {
          await fs.promises.rename(src, dst);
        } catch (e) {
          if (e.code !== 'EXDEV') throw e;
          await fs.promises.copyFile(src, dst);
        }
        for (const it of this.items.values()) if (it.localPath === src) it.localPath = dst;
        moved++;
        await fs.promises.unlink(src).catch(() => {});   // 재생 중이라 못 지우면 다음 실행 때 다시 시도
      } catch (e) {
        this.log(`캐시 옮기기 실패: ${path.basename(src)} (${e.code || e.message})`);
      }
    }
    this.save();
    try { fs.rmdirSync(oldDir); } catch {}
    this.log(`영상 캐시 ${moved}개를 옮겼습니다`);
  }

  // ------------------------------------------------------------ 저장/불러오기
  _file() { return path.join(this.dataDir, 'playlist.json'); }
  _load() {
    try {
      const j = JSON.parse(fs.readFileSync(this._file(), 'utf8'));
      for (const it of j.items || []) {
        if (it.status !== 'ready' && it.status !== 'error') it.status = 'queued';
        if (it.localPath && !fs.existsSync(it.localPath)) { it.localPath = null; it.status = 'queued'; }
        it.progress = it.status === 'ready' ? 1 : 0;
        this.items.set(it.id, it);
      }
      this.playlist = (j.playlist || []).filter((id) => this.items.has(id));
      for (const id of this.playlist) if (this.items.get(id).status === 'queued') this._enqueue(id);
      this._resumeSubs();
    } catch {}
  }
  save() {
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => {
      const items = [...this.items.values()].map((it) => { const c = { ...it }; delete c.runtime; return c; });
      fs.writeFileSync(this._file(), JSON.stringify({ items, playlist: this.playlist }, null, 1));
    }, 300);
  }

  // ------------------------------------------------------------ 조회
  list() { return this.playlist.map((id) => this.public(this.items.get(id))); }
  get(id) { return this.items.get(id); }
  public(it) {
    if (!it) return null;
    return {
      id: it.id, title: it.title, kind: it.kind, source: it.source, status: it.status, progress: it.progress || 0,
      duration: it.duration || 0, error: it.error || null, live: !!it.live, mode: it.mode, isImage: !!it.isImage,
      subs: (it.subs || []).map((s) => ({ id: s.id, label: s.label, count: s.count })), sub: it.sub || null, role: it.role || 'playlist',
      statusText: it.statusText || '', subPending: !!it.subPending,
      // 원본에서 바로 재생: remux(그대로) | audio(소리만 변환) | video(영상 변환)
      conv: it.conv && it.localPath ? (it.conv.v === 'encode' ? 'video' : it.conv.a === 'encode' ? 'audio' : 'remux') : null,
    };
  }

  _emit() { this.emit('change'); this.save(); }
  _update(it, patch) { Object.assign(it, patch); this.emit('item', this.public(it)); this._throttledChange(); }
  _throttledChange() {
    if (this._chT) return;
    this._chT = setTimeout(() => { this._chT = null; this._emit(); }, 250);
  }

  // ------------------------------------------------------------ 추가
  _newItem(base) {
    const it = { id: uid(), status: 'queued', progress: 0, subs: [], sub: null, role: 'playlist', mode: 'download', createdAt: Date.now(), ...base };
    this.items.set(it.id, it);
    return it;
  }
  _push(items, role) {
    for (const it of items) {
      it.role = role;
      if (role === 'playlist') this.playlist.push(it.id);
      this._enqueue(it.id);
    }
    this._emit();
    return items.map((i) => this.public(i));
  }

  addFiles(paths, { role = 'playlist' } = {}) {
    const vids = [];
    const subs = [];
    for (const p of paths) {
      const e = extOf(p);
      if (SUB_EXT.includes(e)) subs.push(p);
      else if (VIDEO_EXT.includes(e) || IMAGE_EXT.includes(e)) vids.push(p);
    }
    vids.sort((a, b) => natural(path.basename(a), path.basename(b)));
    const items = vids.map((p) => this._newItem({ kind: 'file', source: p, title: path.basename(p).replace(/\.[^.]+$/, ''), isImage: IMAGE_EXT.includes(extOf(p)) }));
    // 같은 이름 자막 자동 매칭 (선택 목록 + 같은 폴더)
    for (const it of items) {
      const found = matchSubs(it.source, subs.length ? subs : listDir(path.dirname(it.source)).filter((f) => SUB_EXT.includes(extOf(f))));
      for (const s of found) this._attachSubFile(it, s, false);
    }
    return this._push(items, role);
  }

  addFolder(dir, opts = {}) {
    const all = walk(dir);
    return this.addFiles(all, opts);
  }

  async addUrls(text, { role = 'playlist', mode = 'auto' } = {}) {
    const urls = String(text).split(/\s+/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s));
    const created = [];
    for (let u of urls) {
      u = normalizeUrl(u);
      const e = extOf(u);
      if (SUB_EXT.includes(e)) continue;
      if (e === 'm3u8') created.push(this._newItem({ kind: 'hls', source: u, title: titleFromUrl(u), mode: 'stream' }));
      else if (DIRECT_EXT.includes(e) || IMAGE_EXT.includes(e)) created.push(this._newItem({ kind: 'direct', source: u, title: titleFromUrl(u), mode: mode === 'download' ? 'download' : 'stream', isImage: IMAGE_EXT.includes(e) }));
      else {
        // 디렉터리 목록(자체 웹서버) 시도 → 실패하면 yt-dlp
        const listed = await this._tryDirListing(u);
        if (listed && listed.length) { created.push(...listed); continue; }
        created.push(this._newItem({ kind: 'ytdl', source: u, title: u, mode: mode === 'stream' ? 'stream' : 'download', statusText: '정보 확인 중' }));
      }
    }
    // 자막 URL은 마지막 영상들에 이름으로 매칭
    const subUrls = urls.filter((u) => SUB_EXT.includes(extOf(u)));
    for (const su of subUrls) {
      const target = created.find((c) => titleFromUrl(su).startsWith(c.title)) || created[created.length - 1];
      if (target) this.attachSubtitleUrl(target.id, su).catch(() => {});
    }
    return this._push(created, role);
  }

  async _tryDirListing(u) {
    // HTML 디렉터리 인덱스(Apache/nginx/IIS/python http.server 등)에서 영상·자막 링크 수집
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
      const ct = r.headers.get('content-type') || '';
      if (!ct.includes('text/html')) {
        if (/video|audio|octet-stream/.test(ct)) return [this._newItem({ kind: 'direct', source: u, title: titleFromUrl(u), mode: 'stream' })];
        if (/mpegurl/.test(ct)) return [this._newItem({ kind: 'hls', source: u, title: titleFromUrl(u), mode: 'stream' })];
        return null;
      }
      const html = (await r.text()).slice(0, 2_000_000);
      const hrefs = [...html.matchAll(/href\s*=\s*["']([^"'#?]+)["']/gi)].map((m) => { try { return new URL(m[1], r.url).href; } catch { return null; } }).filter(Boolean);
      const vids = [...new Set(hrefs.filter((h) => DIRECT_EXT.includes(extOf(h)) || extOf(h) === 'm3u8'))];
      // 디렉터리 목록이 아닌 일반 웹페이지(유튜브 등)는 영상 링크가 거의 없으므로 yt-dlp로
      if (vids.length === 0 || /youtube|youtu\.be|drive\.google|twitch|chzzk|vimeo|nicovideo|bilibili|afreeca|sooplive/.test(u)) return null;
      const subs = [...new Set(hrefs.filter((h) => SUB_EXT.includes(extOf(h))))];
      vids.sort((a, b) => natural(decodeURIComponent(a), decodeURIComponent(b)));
      return vids.map((v) => {
        const it = this._newItem({ kind: extOf(v) === 'm3u8' ? 'hls' : 'direct', source: v, title: titleFromUrl(v), mode: 'stream' });
        for (const s of matchSubs(decodeURIComponent(v), subs.map((x) => decodeURIComponent(x)))) this.attachSubtitleUrl(it.id, encodeURI(s)).catch(() => {});
        return it;
      });
    } catch {
      return null;
    }
  }

  remove(id) {
    const it = this.items.get(id);
    if (!it) return;
    this.jobs.get(id)?.abort();
    this.subJobs.get(id)?.abort();
    this.live.stop(id);
    this.playlist = this.playlist.filter((x) => x !== id);
    if (it.cached && it.localPath && isInside(it.localPath, this.cacheDir)) rmRetry(it.localPath);   // 방금 멈춘 ffmpeg가 아직 쥐고 있을 수 있음
    for (const s of it.subs || []) fs.rm(path.join(this.subDir, s.id + '.json'), { force: true }, () => {});
    this.items.delete(id);
    this._emit();
  }
  move(id, toIndex) {
    const i = this.playlist.indexOf(id);
    if (i < 0) return;
    this.playlist.splice(i, 1);
    this.playlist.splice(Math.max(0, Math.min(toIndex, this.playlist.length)), 0, id);
    this._emit();
  }
  clear() { for (const id of [...this.playlist]) this.remove(id); }
  setMode(id, mode) {
    const it = this.items.get(id);
    if (!it || it.kind === 'file') return;
    it.mode = mode;
    if (it.status !== 'downloading') { it.status = 'queued'; this._enqueue(id); }
    this._emit();
  }
  retry(id) {
    const it = this.items.get(id);
    if (!it) return;
    this.live.stop(id);
    it.status = 'queued'; it.error = null; it.progress = 0;
    this._enqueue(id);
    this._emit();
  }
  rename(id, title) { const it = this.items.get(id); if (it) { it.title = String(title).slice(0, 200); this._emit(); } }
  // '원본에서 바로 재생' 설정을 바꿨을 때: 이미 준비된 내 PC 영상도 새 방식으로 다시 준비
  applyDirectPlay() {
    const on = this.settings.directPlay !== false;
    for (const it of this.items.values()) {
      if (it.isImage || it.role === 'lobby') continue;
      // 링크에서 내려받아 캐시에서 바로 재생하던 것: 다시 받지 않고 받아 둔 파일로 다시 준비
      if (it.kind !== 'file') {
        if (!on && it.status === 'ready' && it.conv && it.localPath && isInside(it.localPath, this.cacheDir)) {
          it.reprep = it.localPath;
          this.retry(it.id);
        }
        continue;
      }
      // 준비(변환) 중이던 것은 멈추고, 그 작업이 끝나면 새 방식으로 다시 준비 (대기 중인 것은 그대로 두면 새 설정으로 준비됨)
      const job = this.jobs.get(it.id);
      if (it.status === 'preparing' && job) {
        job.requeue = true; job.abort();
        rmRetry(path.join(this.cacheDir, it.id + '.mp4'));   // 쓰다 만 변환 파일
        this._update(it, { status: 'queued', progress: 0, statusText: '' });
        continue;
      }
      if (it.status !== 'ready') continue;
      const converted = it.cached && it.localPath && isInside(it.localPath, this.cacheDir);
      if (on ? !converted || it.noLive : !it.conv) continue;   // 길이를 몰라 바로 재생할 수 없는 파일은 변환해 둔 그대로
      if (converted) rmRetry(it.localPath);
      Object.assign(it, { localPath: null, cached: false, conv: null });
      this.retry(it.id);
    }
  }

  // ------------------------------------------------------------ 자막
  _attachSubFile(it, file, emit = true, label = null) {
    try {
      const cues = parseSubtitle(fs.readFileSync(file), file);
      if (!cues.length) return null;
      return this._storeSub(it, cues, label || path.basename(file), emit);
    } catch { return null; }
  }
  _storeSub(it, cues, label, emit = true) {
    const sid = uid();
    fs.writeFileSync(path.join(this.subDir, sid + '.json'), JSON.stringify(cues));
    it.subs = it.subs || [];
    it.subs.push({ id: sid, label, count: cues.length });
    if (!it.sub) it.sub = sid;
    if (emit) this._emit();
    return sid;
  }
  attachSubtitleFile(id, file) {
    const it = this.items.get(id);
    if (!it) throw new Error('항목 없음');
    const sid = this._attachSubFile(it, file);
    if (!sid) throw new Error('자막을 읽을 수 없습니다');
    it.sub = sid;
    this._emit();
    return sid;
  }
  async attachSubtitleUrl(id, url) {
    const it = this.items.get(id);
    if (!it) return;
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    const buf = Buffer.from(await r.arrayBuffer());
    const cues = parseSubtitle(buf, url);
    if (cues.length) this._storeSub(it, cues, decodeURIComponent(titleFromUrl(url, true)));
  }
  selectSub(id, sid) { const it = this.items.get(id); if (it) { it.sub = sid || null; this._emit(); } }
  removeSub(id, sid) {
    const it = this.items.get(id);
    if (!it) return;
    it.subs = (it.subs || []).filter((s) => s.id !== sid);
    if (it.sub === sid) it.sub = it.subs[0]?.id || null;
    fs.rm(path.join(this.subDir, sid + '.json'), { force: true }, () => {});
    this._emit();
  }
  subPath(sid) { return /^[0-9a-f]{12}$/.test(sid) ? path.join(this.subDir, sid + '.json') : null; }

  // ------------------------------------------------------------ 준비 큐
  setCurrentIndex(i) { this.currentIndex = i; this._pump(); }
  _enqueue(id) { if (!this.queue.includes(id)) this.queue.push(id); this._pump(); }
  _pump() {
    const maxJobs = 2;
    const prefetch = this.settings.prefetch ?? 3;
    while (this.running < maxJobs) {
      // 우선순위: 로비 → 현재 재생 위치에 가까운 순
      const ranked = this.queue
        .map((id) => ({ id, it: this.items.get(id) }))
        .filter((x) => x.it && x.it.status === 'queued')
        .map((x) => {
          const idx = this.playlist.indexOf(x.id);
          let pri = x.it.role === 'lobby' ? -1 : idx >= this.currentIndex ? idx - this.currentIndex : 1000 + idx;
          // 다운로드형 항목은 재생 위치 근처(prefetch)만 미리 받는다. 메타정보 조회는 항상 허용
          const heavy = x.it.mode === 'download' && (x.it.kind === 'ytdl' || x.it.kind === 'direct') && x.it.infoDone;
          if (heavy && x.it.role !== 'lobby' && pri > prefetch && pri < 1000) pri = Infinity;
          return { ...x, pri };
        })
        .filter((x) => x.pri !== Infinity)
        .sort((a, b) => a.pri - b.pri);
      if (!ranked.length) break;
      const { id, it } = ranked[0];
      this.queue = this.queue.filter((x) => x !== id);
      this.running++;
      const ac = new AbortController();
      this.jobs.set(id, ac);
      this._prepare(it, ac.signal)
        .catch((e) => { if (!ac.signal.aborted) this._update(it, { status: 'error', error: String(e.message || e).slice(0, 300), statusText: '' }); })
        .finally(() => {
          this.running--;
          this.jobs.delete(id);
          if ((!ac.signal.aborted || ac.requeue) && it.status === 'queued' && this.items.has(id)) this.queue.push(id); // 메타정보 단계 후 / 방식이 바뀌어 다시 대기
          this._pump();
        });
    }
  }

  async _prepare(it, signal) {
    if (it.kind === 'file') return this._prepareLocal(it, it.source, signal);
    // 재생 방식만 바뀐 내려받은 항목: 받아 둔 파일로 다시 준비
    if (it.reprep) {
      const f = it.reprep;
      delete it.reprep;
      if (fs.existsSync(f)) {
        await this._prepareLocal(it, f, signal);
        if (it.localPath !== f) this._rmAfterSubs(it, f);
        return;
      }
    }
    if (it.kind === 'hls') {
      this._update(it, { status: 'ready', progress: 1, statusText: '' });
      return;
    }
    if (it.kind === 'direct') {
      if (it.isImage) return this._update(it, { status: 'ready', progress: 1 });
      if (it.mode === 'stream') {
        const d = await probeDuration(it.source);
        this._update(it, { status: 'ready', progress: 1, duration: d || it.duration || 0, remote: { url: it.source, headers: { 'User-Agent': UA } }, statusText: '' });
        return;
      }
      return this._downloadDirect(it, signal);
    }
    if (it.kind === 'ytdl') {
      if (!it.infoDone) return this._ytInfo(it, signal);
      if (it.mode === 'stream' || it.live) {
        await this.resolveStream(it);
        this._update(it, { status: 'ready', progress: 1, statusText: '' });
        return;
      }
      return this._ytDownload(it, signal);
    }
  }

  // 로컬 파일: 브라우저 재생 가능 여부 확인 → 그대로 / 원본에서 바로 재생(실시간 변환) / 캐시에 변환. 내장 자막은 따로 추출
  async _prepareLocal(it, file, signal) {
    if (!fs.existsSync(file)) throw new Error('파일을 찾을 수 없습니다: ' + file);
    if (it.isImage) return this._update(it, { status: 'ready', progress: 1, localPath: file, conv: null });
    this._update(it, { status: 'preparing', statusText: '파일 분석 중', progress: 0 });
    const info = await ffprobe(file);
    if (!info) throw new Error('ffprobe로 파일을 읽을 수 없습니다');
    if (signal.aborted) return;
    const duration = parseFloat(info.format?.duration) || 0;
    const v = info.streams.find((s) => s.codec_type === 'video' && !(s.disposition?.attached_pic));
    const a = info.streams.find((s) => s.codec_type === 'audio');
    const fmt = info.format?.format_name || '';
    const ext = extOf(file);
    const vOk = !v || (OK_VCODEC.includes(v.codec_name) && !/10le|12le|422|444/.test(v.pix_fmt || ''));
    const aOk = !a || (OK_ACODEC.includes(a.codec_name) && (a.channels || 2) <= 2);
    const containerOk = ['mp4', 'm4v', 'mov', 'webm', 'mp3', 'm4a', 'ogg', 'opus', 'flac', 'wav'].includes(ext) && /mp4|mov|webm|matroska|mp3|ogg|flac|wav/.test(fmt);
    // 외부 자막이 없으면 내장 텍스트 자막 추출 (MKV 애니 등). 큰 파일은 끝까지 읽어야 해서 재생 준비와 따로 진행
    this._extractSubs(it, file, info);
    const ready = (patch) => this._update(it, { status: 'ready', progress: 1, duration, statusText: '', conv: null, noLive: false, ...patch });

    if (vOk && aOk && containerOk) return ready({ localPath: file });
    // 원본에서 바로 재생: 캐시에 통째로 변환하지 않고 재생하는 부분만 그때그때 변환 (로비 전광판의 반복 재생 영상은 미리 변환)
    if (this.settings.directPlay !== false && it.role !== 'lobby' && duration > 0) {
      const conv = await livePlan(file, info, v, a);
      if (signal.aborted) return;
      if (conv) return ready({ localPath: file, conv, cached: isInside(file, this.cacheDir) });
    }
    // 변환
    const out = path.join(this.cacheDir, it.id + '.mp4');
    const args = ['-y', '-v', 'error', '-progress', 'pipe:1', '-nostats', '-i', file, '-map', '0:v:0?', '-map', '0:a:0?', '-sn', '-dn'];
    let label;
    if (vOk) args.push('-c:v', 'copy');
    else if (await hasNvenc()) { args.push('-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', '21', '-pix_fmt', 'yuv420p'); label = 'GPU 변환'; }
    else { args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p'); label = 'CPU 변환(느림)'; }
    if (aOk && a) args.push('-c:a', 'copy');
    else if (a) args.push('-c:a', 'aac', '-b:a', '192k', '-ac', '2');
    args.push('-movflags', '+faststart', out);
    const what = vOk ? (aOk ? '컨테이너 변환' : '오디오 변환') : label;
    this._update(it, { status: 'preparing', statusText: what + ' 중', progress: 0 });
    const r = await run(TOOLS.ffmpeg, args, {
      signal,
      onLine: (l) => {
        const m = l.match(/^out_time_us=(\d+)/);
        if (m && duration) this._update(it, { progress: Math.min(0.999, +m[1] / 1e6 / duration) });
      },
    });
    if (signal.aborted) return;
    if (r.code !== 0) throw new Error('변환 실패: ' + r.stderr.split('\n').filter(Boolean).slice(-2).join(' '));
    ready({ localPath: out, cached: true, noLive: !(duration > 0) });
  }

  // 내장 텍스트 자막 추출: 한 번 읽으면서 고른 트랙을 모두 뽑는다. 큰 파일은 끝까지 읽어야 하므로 한 번에 하나씩,
  // 지금 상영 위치에 가까운 항목부터. 서버를 끄면 멈췄다가 다시 열 때 이어서(처음부터) 진행
  _extractSubs(it, file, info) {
    if ((it.subs || []).length || this.subJobs.has(it.id)) return;
    const subs = info.streams.filter((s) => s.codec_type === 'subtitle' && ['ass', 'ssa', 'subrip', 'mov_text', 'webvtt', 'text'].includes(s.codec_name));
    subs.sort((x, y) => langScore(y) - langScore(x));
    if (!subs.length) return;
    it.subSrc = file;   // 자막 트랙 번호가 가리키는 파일 (내려받은 원본은 변환 뒤 지워지므로 추출이 끝난 뒤에 지움)
    it.subPending = subs.slice(0, 3).map((s) => ({
      i: s.index, ass: s.codec_name === 'ass' || s.codec_name === 'ssa',
      label: `내장 자막 #${s.index}${s.tags?.language ? ' (' + s.tags.language + ')' : ''}${s.tags?.title ? ' ' + s.tags.title : ''}`,
    }));
    this._runSubs(it, file);
  }
  _runSubs(it, file) {
    const ac = new AbortController();
    this.subJobs.set(it.id, ac);
    this.subQueue.push({ it, file, ac });
    this._pumpSubs();
  }
  // 자막 추출이 끝난 뒤(없으면 바로) 캐시의 임시 원본을 지운다
  _rmAfterSubs(it, f) {
    const job = this.subJobs.get(it.id);
    if (job) job.after = () => rmRetry(f); else rmRetry(f);
  }
  _pumpSubs() {
    while (this.subRunning < 1) {
      this.subQueue = this.subQueue.filter((j) => {
        const keep = !j.ac.signal.aborted && this.items.get(j.it.id) === j.it;
        if (!keep) j.ac.after?.();
        return keep;
      });
      if (!this.subQueue.length) return;
      const rank = (j) => { const i = this.playlist.indexOf(j.it.id); return j.it.role === 'lobby' ? -1 : i >= this.currentIndex ? i - this.currentIndex : 1000 + i; };
      const job = this.subQueue.reduce((a, b) => (rank(b) < rank(a) ? b : a));
      this.subQueue.splice(this.subQueue.indexOf(job), 1);
      this.subRunning++;
      this._subJob(job).finally(() => { this.subRunning--; this._pumpSubs(); });
    }
  }
  _subJob({ it, file, ac }) {
    const outs = it.subPending.map((s) => ({ ...s, out: path.join(this.cacheDir, `${it.id}_s${s.i}.${s.ass ? 'ass' : 'srt'}`) }));
    const args = ['-y', '-v', 'error', '-nostdin', '-i', file];
    for (const o of outs) args.push('-map', `0:${o.i}`, '-f', o.ass ? 'ass' : 'srt', o.out);
    return run(TOOLS.ffmpeg, args, { signal: ac.signal }).then(() => {
      if (this.subJobs.get(it.id) === ac) this.subJobs.delete(it.id);
      const alive = !ac.signal.aborted && this.items.get(it.id) === it;
      for (const o of outs) {
        try {
          const cues = alive && fs.existsSync(o.out) ? parseSubtitle(fs.readFileSync(o.out), o.out) : [];
          if (cues.length) this._storeSub(it, cues, o.label, false);
        } catch {}
        fs.rm(o.out, { force: true }, () => {});
      }
      ac.after?.();
      if (!alive) return;
      it.subPending = null;
      it.subSrc = null;
      this._emit();   // 재생 상태도 다시 퍼져서 상영 중이면 접속자 화면에 자막이 붙는다
    });
  }
  _resumeSubs() {
    for (const it of this.items.values()) {
      if (!it.subPending?.length || this.subJobs.has(it.id) || it.status !== 'ready') continue;
      const file = it.subSrc || (it.kind === 'file' ? it.source : it.localPath);
      if (!file || !fs.existsSync(file)) { it.subPending = it.subSrc = null; continue; }
      this._runSubs(it, file);
      // 남아 있던 임시 원본(변환 뒤 지우려던 내려받은 파일)은 추출이 끝나면 지운다
      if (file !== it.localPath && file !== it.source && isInside(file, this.cacheDir)) this.subJobs.get(it.id).after = () => rmRetry(file);
    }
  }

  async _downloadDirect(it, signal) {
    this._update(it, { status: 'downloading', statusText: '다운로드 중', progress: 0 });
    const out = path.join(this.cacheDir, it.id + '.' + (extOf(it.source) || 'mp4'));
    const r = await fetch(it.source, { headers: { 'User-Agent': UA }, signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const total = +r.headers.get('content-length') || 0;
    const ws = fs.createWriteStream(out);
    let got = 0;
    for await (const chunk of r.body) {
      ws.write(chunk);
      got += chunk.length;
      if (total) this._update(it, { progress: got / total * 0.95 });
    }
    await new Promise((res) => ws.end(res));
    it.cached = true;
    await this._prepareLocal(it, out, signal);
    if (it.localPath !== out) this._rmAfterSubs(it, out);
  }

  // yt-dlp: 메타정보 (재생목록이면 항목 펼치기)
  async _ytInfo(it, signal) {
    this._update(it, { status: 'preparing', statusText: '링크 정보 확인 중' });
    const r = await run(TOOLS.ytdlp, ['-J', '--flat-playlist', '--no-warnings', '--ignore-no-formats-error', it.source], { signal, timeout: 120000 });
    if (signal.aborted) return;
    let j;
    try { j = JSON.parse(r.stdout); } catch { throw new Error('지원하지 않거나 접근할 수 없는 링크입니다. ' + lastErr(r.stderr)); }
    if (j._type === 'playlist' && Array.isArray(j.entries)) {
      const entries = j.entries.filter((e) => e && (e.url || e.webpage_url || e.id));
      const idx = this.playlist.indexOf(it.id);
      const news = entries.map((e) => this._newItem({
        kind: 'ytdl', mode: it.mode, role: it.role,
        source: e.webpage_url || (e.url && /^https?:/.test(e.url) ? e.url : null) || (e.ie_key === 'Youtube' ? 'https://www.youtube.com/watch?v=' + e.id : e.url),
        title: e.title || e.id || '영상', duration: e.duration || 0, statusText: '대기',
      }));
      if (it.role === 'playlist') this.playlist.splice(idx, 1, ...news.map((n) => n.id));
      this.items.delete(it.id);
      for (const n of news) this._enqueue(n.id);
      this.emit('expanded', { from: it.id, to: news.map((n) => n.id), title: j.title });
      this._emit();
      return;
    }
    this._update(it, {
      title: j.title || it.title, duration: j.duration || 0, live: !!j.is_live || j.live_status === 'is_live',
      thumbnail: j.thumbnail || null, infoDone: true, status: 'queued',
      statusText: it.mode === 'download' && !j.is_live ? '다운로드 대기' : '',
    });
  }

  _fmt() {
    const h = this.settings.maxHeight || 1080;
    return `bv*[height<=${h}][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=${h}][vcodec^=vp09]+ba/bv*[height<=${h}]+ba/b[height<=${h}]/b`;
  }

  async _ytDownload(it, signal) {
    this._update(it, { status: 'downloading', statusText: '다운로드 중', progress: 0 });
    const tmpl = path.join(this.cacheDir, it.id + '.%(ext)s');
    const args = ['--no-playlist', '--no-warnings', '--newline', '-f', this._fmt(), '--merge-output-format', 'mp4',
      '--ffmpeg-location', path.dirname(TOOLS.ffmpeg), '-o', tmpl, '--no-part', '--concurrent-fragments', '4'];
    if (this.settings.ytSubs !== false) args.push('--write-subs', '--sub-langs', this.settings.subLangs || 'ko.*,ko,en.*,en,ja', '--convert-subs', 'srt');
    args.push(it.source);
    let phase = 0;
    const r = await run(TOOLS.ytdlp, args, {
      signal,
      onLine: (l) => {
        const m = l.match(/\[download\]\s+([\d.]+)%/);
        if (m) {
          if (+m[1] < 1 && it.progress > 0.4 && phase === 0) phase = 1; // 영상 → 음성 두번째 파일
          this._update(it, { progress: Math.min(0.97, phase === 0 ? +m[1] / 100 * 0.85 : 0.85 + +m[1] / 100 * 0.12) });
        }
        if (/\[Merger\]/.test(l)) this._update(it, { statusText: '영상/음성 합치는 중' });
      },
    });
    if (signal.aborted) return;
    const files = fs.readdirSync(this.cacheDir).filter((f) => f.startsWith(it.id + '.'));
    const vid = files.find((f) => VIDEO_EXT.includes(extOf(f)));
    if (r.code !== 0 || !vid) throw new Error('다운로드 실패: ' + lastErr(r.stderr));
    for (const f of files.filter((f) => SUB_EXT.includes(extOf(f)))) {
      const lang = (f.match(/\.([\w-]+)\.\w+$/) || [])[1] || '';
      this._attachSubFile(it, path.join(this.cacheDir, f), false, `자막 (${lang || '기본'})`);
      fs.rm(path.join(this.cacheDir, f), { force: true }, () => {});
    }
    it.cached = true;
    await this._prepareLocal(it, path.join(this.cacheDir, vid), signal);
  }

  // 스트리밍 모드: 재생 직전 실제 미디어 URL 해석 (만료되므로 재생 때마다)
  async resolveStream(it) {
    if (it.kind !== 'ytdl') return;
    const fresh = it.remote && Date.now() - (it.remote.at || 0) < 20 * 60 * 1000;
    if (fresh) return;
    const h = this.settings.maxHeight || 1080;
    // 1) 합쳐진 HLS(생방송 등) 2) 합쳐진 단일 파일 3) 영상 m3u8 + 음성 m3u8 (유튜브 VOD) → 서버가 마스터 재생목록으로 묶음
    const fmt = [
      `b[protocol^=m3u8][height<=${h}]`, `b[height<=${h}][vcodec!=none][acodec!=none]`,
      `bv*[protocol^=m3u8][height<=${h}][vcodec^=avc1]+ba[protocol^=m3u8]`, `bv*[protocol^=m3u8][height<=${h}]+ba[protocol^=m3u8]`,
      'b[protocol^=m3u8]', 'b',
    ].join('/');
    const r = await run(TOOLS.ytdlp, ['-J', '--no-playlist', '--no-warnings', '-f', fmt, it.source], { timeout: 90000 });
    let j = null;
    try { j = JSON.parse(r.stdout); } catch {}
    if (!j) throw new Error('스트림 주소를 가져오지 못했습니다. "미리 받아서 재생"으로 바꿔 주세요. ' + lastErr(r.stderr));
    const headers = { 'User-Agent': UA, ...(j.http_headers || {}) };
    const rf = j.requested_formats;
    if (Array.isArray(rf) && rf.length === 2 && rf.every((f) => /m3u8/.test(f.protocol || ''))) {
      it.remote = { master: true, video: rf[0].url, audio: rf[1].url, headers: { ...headers, ...(rf[0].http_headers || {}) }, hls: true, at: Date.now(),
        width: rf[0].width, height: rf[0].height, bw: Math.round((rf[0].tbr || 2000) * 1000) };
    } else {
      const url = j.url || rf?.[0]?.url;
      if (!url || (rf && rf.length > 1)) throw new Error('바로 재생 가능한 스트림이 없습니다. "미리 받아서 재생"으로 바꿔 주세요.');
      it.remote = { url, headers, hls: /m3u8/.test(j.protocol || '') || /\.m3u8/.test(url), at: Date.now() };
    }
    it.live = !!j.is_live || it.live;
    if (j.duration) it.duration = j.duration;
    if (j.title) it.title = j.title;
  }

  // ------------------------------------------------------------ 클라이언트 재생 정보
  sign(id, u) { return crypto.createHmac('sha256', this.secret).update(id + '|' + u).digest('hex').slice(0, 20); }
  playInfo(it) {
    if (!it || it.status !== 'ready') return null;
    const base = { id: it.id, title: it.title, duration: it.duration || 0, live: !!it.live, image: !!it.isImage, sub: it.sub ? `/subs/${it.sub}.json` : null };
    const key = this.live.key(it);
    if (key) return { ...base, type: 'hls', conv: true, url: `/m/${it.id}/live/${key}/index.m3u8` };
    if (it.localPath) return { ...base, type: it.isImage ? 'image' : 'file', url: `/m/${it.id}/file` };
    if (it.remote?.master) return { ...base, type: 'hls', url: `/m/${it.id}/master.m3u8?v=${it.remote.at}` };
    if (it.kind === 'hls' || it.remote?.hls) {
      const u = it.kind === 'hls' ? it.source : it.remote.url;
      return { ...base, type: 'hls', url: `/m/${it.id}/h/index.m3u8?u=${b64(u)}&s=${this.sign(it.id, u)}` };
    }
    if (it.kind === 'direct' && it.isImage) return { ...base, type: 'image', url: `/m/${it.id}/r` };
    return { ...base, type: 'file', url: `/m/${it.id}/r` };
  }

  // ------------------------------------------------------------ 캐시
  cacheSize() {
    let n = this.live.size();
    for (const f of listDir(this.cacheDir)) { try { const st = fs.statSync(f); if (st.isFile()) n += st.size; } catch {} }
    return n;
  }
  clearCache() {
    const used = new Set([...this.items.values()].flatMap((i) => [i.localPath, i.subPending && i.subSrc]).filter(Boolean));
    const extracting = (f) => [...this.subJobs.keys()].some((id) => path.basename(f).startsWith(id + '_s'));
    for (const f of listDir(this.cacheDir)) if (!used.has(f) && f !== this.live.dir && !extracting(f)) fs.rm(f, { force: true }, () => {});
  }
  // 서버를 끌 때: 진행 중인 준비 작업을 멈추고 캐시 폴더의 영상을 모두 지운다 (내가 추가한 원본 파일은 캐시 폴더 밖이라 그대로).
  // 캐시 영상을 쓰던 항목은 '대기'로 돌려 두고, 서버를 다시 열 때 requeue()로 다시 준비한다.
  purgeCache() {
    for (const ac of this.jobs.values()) ac.abort();
    for (const ac of this.subJobs.values()) ac.abort();   // 자막 추출은 subPending을 남겨 두고 다시 열 때 이어서
    this.subJobs.clear();
    this.live.stopAll();
    const root = path.resolve(this.cacheDir) + path.sep;
    for (const it of this.items.values()) {
      const inCache = it.cached && it.localPath && path.resolve(it.localPath).startsWith(root);
      if (inCache) { it.localPath = null; it.cached = false; }
      if (inCache || !['ready', 'error', 'queued'].includes(it.status)) Object.assign(it, { status: 'queued', progress: 0, statusText: '' });
    }
    this.queue = [];
    let files = 0, bytes = 0;
    const busy = [];
    for (const f of listDir(this.cacheDir)) {
      if (f === this.live.dir) continue;   // 바로 재생 조각은 stopAll이 정리
      let size = 0;
      try { size = fs.statSync(f).size; } catch {}
      try { fs.rmSync(f, { force: true }); files++; bytes += size; } catch { busy.push(f); }
    }
    // 방금 멈춘 작업이 아직 쥐고 있던 파일은 잠시 뒤 다시 지운다
    if (busy.length) setTimeout(() => { for (const f of busy) fs.rm(f, { force: true }, () => {}); }, 3000);
    this._emit();
    return { files, bytes };
  }
  // 서버를 열 때: 대기 중인 항목을 다시 준비 큐에 넣는다
  requeue() {
    for (const it of this.items.values()) if (it.status === 'queued') this._enqueue(it.id);
    this._resumeSubs();
  }
}

// ------------------------------------------------------------ 유틸
function walk(dir, out = [], depth = 0) {
  if (depth > 6) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, depth + 1);
    else out.push(p);
  }
  return out;
}
function listDir(dir) { try { return fs.readdirSync(dir).map((f) => path.join(dir, f)); } catch { return []; } }
function isInside(file, dir) { return path.resolve(file).toLowerCase().startsWith(path.resolve(dir).toLowerCase() + path.sep); }
// 방금 멈춘 ffmpeg가 아직 파일을 쥐고 있으면(EBUSY) 잠시 뒤 다시 지운다 (Node는 recursive일 때만 maxRetries를 씀)
function rmRetry(f) { fs.rm(f, { force: true, recursive: true, maxRetries: 10, retryDelay: 300 }, () => {}); }
function matchSubs(video, candidates) {
  const base = path.basename(video).replace(/\.[^.]+$/, '').toLowerCase();
  const found = candidates.filter((s) => {
    const b = path.basename(s).toLowerCase();
    return b.startsWith(base + '.') || b === base;
  });
  const score = (s) => (/\.(ko|kor|kr|korean)\./i.test(path.basename(s)) ? 2 : 0) + (/\.smi$/i.test(s) ? 1 : 0);
  return found.sort((a, b) => score(b) - score(a));
}
function langScore(s) {
  const l = (s.tags?.language || '') + ' ' + (s.tags?.title || '');
  return /kor|ko\b|한국|자막/i.test(l) ? 3 : /eng|en\b/i.test(l) ? 1 : 0;
}
function titleFromUrl(u, keepExt = false) {
  try {
    const p = new URL(u).pathname.split('/').filter(Boolean).pop() || u;
    const d = decodeURIComponent(p);
    return keepExt ? d : d.replace(/\.[^.]+$/, '');
  } catch { return u; }
}
function normalizeUrl(u) {
  // 드롭박스 공유 링크 → 직접 다운로드
  if (/dropbox\.com/.test(u)) return u.replace(/([?&])dl=0/, '$1dl=1').replace(/(\?|&)raw=0/, '$1raw=1') + (/[?&]dl=/.test(u) ? '' : (u.includes('?') ? '&' : '?') + 'raw=1');
  return u;
}
function b64(s) { return Buffer.from(s).toString('base64url'); }
function lastErr(s) { return (s || '').split('\n').filter((l) => /error/i.test(l)).slice(-1)[0] || (s || '').trim().split('\n').slice(-1)[0] || ''; }
async function ffprobe(file) {
  const r = await run(TOOLS.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeout: 60000 });
  try { return JSON.parse(r.stdout); } catch { return null; }
}
async function probeDuration(url) {
  const r = await run(TOOLS.ffprobe, ['-v', 'error', '-user_agent', UA, '-show_entries', 'format=duration', '-of', 'csv=p=0', url], { timeout: 20000 });
  return parseFloat(r.stdout) || 0;
}

module.exports = { MediaManager, VIDEO_EXT, IMAGE_EXT, SUB_EXT, UA };
