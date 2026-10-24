// 원본 파일 바로 재생: 브라우저가 그대로 못 트는 로컬 영상(MKV·HEVC·AC3 등)을 캐시에 통째로 변환하지 않고,
// 재생 위치 근처만 ffmpeg로 그때그때 HLS 조각(MPEG-TS)으로 잘라(필요하면 변환해) 보낸다.
// 재생목록은 처음부터 끝까지 미리 정해 두고(영상 복사는 키프레임 위치, 변환은 4초 간격), 조각은 접속자 모두가 함께 쓰며 지나간 것은 바로 지운다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { TOOLS, run, hasNvenc } = require('./tools');
const { keyframeIndex } = require('./keyframes');

const SEG = 4;          // 조각 길이(초). 영상 복사는 키프레임에 맞춰 이보다 조금 길어질 수 있음
const MAX_SEG = 30;     // 키프레임 간격이 이보다 길면 복사 대신 변환 (조각이 너무 커짐)
// ffmpeg는 처음 BURST초 분량을 한꺼번에 만든 뒤 재생 속도보다 조금 빠르게(READRATE배) 따라가며 한 번 시작하면 끊지 않는다.
// (실행이 바뀌는 경계에서는 소리가 아주 잠깐 비므로, 위치를 옮기거나 오래 멈췄을 때만 다시 시작)
const BURST = 60;
const READRATE = 1.02;
const AHEAD = 240;      // 재생 위치보다 이만큼(초) 앞서면 ffmpeg를 멈춤 (일시정지가 길어질 때)
const REFILL = 45;      // 멈춘 뒤 앞쪽 여유가 이보다 줄면 이어서 만듦
const BEHIND = 60;      // 재생 위치보다 이만큼 지난 조각은 지움
const LAG = 12;         // 함께 보는 중 재생 위치보다 이만큼 넘게 뒤처진 요청은 공용 변환을 옮기지 못함 (클라이언트가 곧 위치를 맞춤)
const YOUNG = 5000;     // 막 시작한 변환은 처음 몰아서 만드는 동안 조금 앞의 조각도 곧 만든다고 본다(ms)
const BATCH = 1500;     // 영상 복사: ffmpeg 한 번에 넘기는 자르기 위치 수 (명령줄 32K자 제한. 다 쓰면 이어서 다시 시작)
const BATCH_ENC = 1000; // 변환: 강제 키프레임 목록(과 키프레임 위치 자르기 목록)의 길이
const SEEK_BACKOFF = 0.130434; // ffmpeg_demux.c의 dts_heuristic: 3*AV_TIME_BASE/23
const WAIT = 25000;     // 아직 없는 조각 요청을 붙잡아 두는 최대 시간(ms)
const IDLE = 60000;     // 요청이 끊긴 세션 정리(ms). 지금 상영 중이 아닌 항목은 15초

const OK_TS_ACODEC = ['aac'];   // hls.js는 TS 안의 MP3를 타임스탬프가 아닌 재생목록 시각에 붙이므로 AAC만 그대로 쓴다

// 브라우저가 그대로 못 트는 파일의 재생 방식 결정 (ffprobe 결과 기준). 바로 재생할 수 없으면 null
async function livePlan(file, info, v, a) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const vids = info.streams.filter((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const conv = {
    v: !v ? null : v.codec_name === 'h264' && /^yuvj?420p$/.test(v.pix_fmt || '') ? 'copy' : 'encode',
    a: !a ? null : OK_TS_ACODEC.includes(a.codec_name) && (a.channels || 2) <= 2 ? 'copy' : 'encode',
    vi: v ? v.index : null,
    ai: a ? a.index : null,
    vo: v ? Math.max(0, vids.indexOf(v)) : 0,
    fmt: info.format?.format_name || '',
    st: parseFloat(info.format?.start_time) || 0,
    hdr: /smpte2084|arib-std-b67/.test(v?.color_transfer || ''),
    vend: v ? streamEnd(v) : 0,
    // 영상이 파일 시작보다 늦게 시작하는 만큼(초). 0초부터의 실행은 segment 먹서가 첫 영상 패킷을 기준으로 삼으므로 필요
    vs: v ? Math.max(0, (parseFloat(v.start_time) || 0) - (parseFloat(info.format?.start_time) || 0)) : 0,
    // ffmpeg는 PTS로 찾아가지 못하는 형식(MKV 등)에 B프레임 스트림이 있으면 -ss에서 3/23초를 빼고 찾아간다 → 영상 복사 때 미리 더해 준다
    sk: !/mov|mp4/.test(info.format?.format_name || '') && info.streams.some((s) => s.has_b_frames > 0) ? SEEK_BACKOFF : 0,
    sig: `${st.size}:${Math.round(st.mtimeMs)}`,
  };
  if (!conv.v && !conv.a) return null;
  // 영상 복사는 키프레임 목록이 있어야 조각 경계를 미리 정할 수 있다 (없으면 변환으로)
  if (conv.v === 'copy' && !cutsFrom((await keyframeIndex(file, { format: conv.fmt, videoOrdinal: conv.vo }))?.times, conv, parseFloat(info.format?.duration) || 0)) conv.v = 'encode';
  return conv;
}

// 영상 스트림이 끝나는 시각(초, 모르면 0). 자막·소리가 더 길어 파일 길이가 영상보다 긴 경우가 있다
function streamEnd(s) {
  const d = parseFloat(s.duration) || (/^(\d+):(\d+):([\d.]+)$/.test(s.tags?.DURATION || '') ? s.tags.DURATION.split(':').reduce((a, x) => a * 60 + +x, 0) : 0);
  return d > 0 ? d + (parseFloat(s.start_time) || 0) : 0;
}
// 영상이 끝나는 시각 (파일 시작 기준). 그 뒤는 마지막 조각이 남은 소리·자막까지 품는다
const videoEnd = ({ st = 0, vend = 0 } = {}, dur) => (vend > 0 ? Math.min(dur, vend - st) : dur);

// 키프레임(초, 파일 시각) → 조각 시작 시각 목록 (0부터, SEG초 이상 간격). 부적합하면 null
function cutsFrom(times, conv, dur) {
  if (!times?.length || !(dur > 0)) return null;
  const starts = [0];
  for (const t0 of times) {
    const t = t0 - (conv?.st || 0);
    if (t < 0.5 || t > dur - 0.5) continue;
    if (t - starts[starts.length - 1] >= SEG - 0.05) starts.push(t);
  }
  // 키프레임 목록이 영상 끝까지 덮는지
  const end = videoEnd(conv, dur);
  for (let i = 0; i < starts.length; i++) if ((starts[i + 1] ?? end) - starts[i] > MAX_SEG) return null;
  return starts;
}
function grid(end) {
  const starts = [];
  for (let t = 0; t < end - 0.5 || !starts.length; t += SEG) starts.push(t);
  return starts;
}

class LiveManager {
  constructor({ dir, settings, log }) {
    this.dir = dir;
    this.settings = settings; // () => media.settings
    this.log = log || (() => {});
    this.sessions = new Map(); // itemId → LiveSession
    this.seq = 0;
    this.getPos = () => null;  // 상영 중인 항목이면 서버 기준 재생 위치(초)
    this.onStale = null;       // (itemId) → 원본이 바뀌었거나 사라짐 (항목을 다시 준비)
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}   // 지난번에 남은 조각
    this._tick = setInterval(() => { for (const s of this.sessions.values()) s.tick(); }, 1000);
    this._tick.unref?.();
  }

  // 재생목록 주소에 넣는 열쇠: 원본·방식이 바뀌면 주소가 바뀌어 클라이언트가 새로 불러온다
  // (화질 설정은 넣지 않음: 상영 중에 바꿔도 보던 스트림이 끊기지 않고 다음 세션부터 적용)
  key(it) {
    const c = it.conv;
    if (!c || !it.localPath) return null;
    return crypto.createHash('sha1').update([it.localPath, c.sig, c.v, c.a].join('|')).digest('hex').slice(0, 10);
  }

  async get(it, key) {
    if (!it || it.status !== 'ready' || !key || key !== this.key(it)) return null;
    let s = this.sessions.get(it.id);
    // 준비에 실패한 세션은 잠시 뒤 다시 만든다 (드라이브가 잠깐 안 보였던 경우 등)
    if (s && (s.key !== key || (s.failedAt && Date.now() - s.failedAt > 5000))) { this.stop(it.id); s = null; }
    if (!s) { s = new LiveSession(this, it, key); this.sessions.set(it.id, s); }
    await s.ready;
    return s.starts && !s.stopped ? s : null;
  }

  stop(id) {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    s.stop();
  }
  stopAll() { for (const id of [...this.sessions.keys()]) this.stop(id); }

  size() {
    let n = 0;
    for (const d of listDir(this.dir)) for (const f of listDir(d)) { try { n += fs.statSync(f).size; } catch {} }
    return n;
  }
}

class LiveSession {
  constructor(mgr, it, key) {
    this.mgr = mgr;
    this.id = it.id;
    this.key = key;
    this.file = it.localPath;
    this.conv = { ...it.conv };
    this.duration = it.duration;
    // 세션마다 새 폴더: 앞 세션이 뒤늦게 지우는 폴더와 겹치지 않게
    this.dir = path.join(mgr.dir, `${it.id}-${key}-${++mgr.seq}`);
    this.files = new Map();   // 조각 번호 → 다 만들어진 파일
    this.waiters = new Map(); // 조각 번호 → [{ res, rej, timer }]
    this.run = null;
    this.runNo = 0;
    this.eof = Infinity;      // 이 번호부터는 원본 끝 너머 (ffmpeg가 끝까지 읽었을 때 알게 됨)
    this.fails = 0;           // 연달아 실패한 변환 수 → 다시 시작을 늦춘다
    this.blockedUntil = 0;
    this.lastReq = Date.now();
    this.lastSeg = 0;
    this.stopped = false;
    this.ready = this._init().catch((e) => {
      this.starts = null;
      this.failedAt = Date.now();
      mgr.log('바로 재생 준비 실패: ' + e.message);
      if (e.stale) mgr.onStale?.(this.id);
    });
  }

  async _init() {
    let st;
    try { st = fs.statSync(this.file); } catch (e) { e.stale = e.code === 'ENOENT'; throw e; }
    if (`${st.size}:${Math.round(st.mtimeMs)}` !== this.conv.sig) throw Object.assign(new Error('원본 파일이 바뀌어 다시 준비합니다: ' + path.basename(this.file)), { stale: true });
    let starts = null;
    if (this.conv.v === 'copy') {
      const times = (await keyframeIndex(this.file, { format: this.conv.fmt, videoOrdinal: this.conv.vo }))?.times;
      starts = cutsFrom(times, this.conv, this.duration);
      if (starts) this.kfs = times.map((t) => t - (this.conv.st || 0));   // 모든 키프레임 (파일 시작 기준)
      else this.conv.v = 'encode';
    }
    // 영상 복사도 경계를 못 맞추면 변환으로 바꾸므로 변환 설정은 늘 준비해 둔다
    this.nvenc = await hasNvenc();
    this.hw = this.nvenc;   // NVIDIA면 디코딩도 GPU로 (지원하지 않는 형식이면 ffmpeg가 알아서 CPU로)
    this.height = outHeight(this.mgr.settings());
    this.grid = !starts;    // SEG초 간격인가 (아니면 키프레임 위치)
    // 변환은 영상이 끝나는 곳까지만 4초 간격 (그 뒤 남은 소리는 마지막 조각이 품음)
    this.starts = starts || grid(this.conv.v ? videoEnd(this.conv, this.duration) : this.duration);
    this.sk = this.conv.sk || 0;
    this.misaligned = 0;   // 폴더는 _start가 만든다 (준비 중에 멈춘 세션이 지운 폴더를 되살리지 않게)
  }

  _nearKeyframe(t) {
    const a = this.kfs || [];
    let lo = 0, hi = a.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < t) lo = mid + 1; else hi = mid; }
    return [a[lo - 1], a[lo]].some((x) => x != null && Math.abs(x - t) < 0.05);
  }

  segStart(k) { return this.starts[k]; }
  segEnd(k) { return k + 1 < this.starts.length ? this.starts[k + 1] : this.duration; }
  segAt(t) {
    let lo = 0, hi = this.starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.starts[mid] <= t) lo = mid; else hi = mid - 1; }
    return lo;
  }

  playlist() {
    const durs = this.starts.map((_, k) => Math.max(0.1, this.segEnd(k) - this.segStart(k)));
    return [
      '#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-PLAYLIST-TYPE:VOD', `#EXT-X-TARGETDURATION:${Math.ceil(Math.max(...durs))}`, '#EXT-X-MEDIA-SEQUENCE:0',
      ...durs.flatMap((d, k) => [`#EXTINF:${d.toFixed(6)},`, `${k}.ts`]),
      '#EXT-X-ENDLIST', '',
    ].join('\n');
  }

  // 조각 요청: 있으면 바로, 없으면 (필요하면 ffmpeg를 그 위치에서 다시 시작해) 만들어질 때까지 기다린다
  segment(k, signal) {
    if (this.stopped) return Promise.reject(httpErr(503));
    if (!(k >= 0 && k < this.starts.length) || k >= this.eof) return Promise.reject(httpErr(404));
    this.lastReq = Date.now();
    this.lastSeg = k;
    const f = this.files.get(k);
    if (f && fs.existsSync(f)) return Promise.resolve(f);
    if (f) this.files.delete(k);
    if (!this._covers(k) && this._mayRestart(k)) this._start(k);
    return new Promise((res, rej) => {
      const w = { res, rej };
      const drop = () => { clearTimeout(w.timer); const l = this.waiters.get(k); if (l) { l.splice(l.indexOf(w) >>> 0, 1); if (!l.length) this.waiters.delete(k); } };
      w.timer = setTimeout(() => { drop(); rej(httpErr(503)); }, WAIT);
      signal?.addEventListener('abort', () => { drop(); rej(httpErr(499)); }, { once: true });
      if (!this.waiters.has(k)) this.waiters.set(k, []);
      this.waiters.get(k).push(w);
    });
  }

  // 지금 변환이 앞으로 만들 조각인가 / 곧 만들 조각인가 (이미 지나간 조각은 다시 만들지 않으므로 r.next부터)
  _willMake(k) { const r = this.run; return !!r && k >= r.next && k < r.until; }
  _covers(k) {
    if (!this._willMake(k)) return false;
    const r = this.run;
    if (k <= r.next + 3) return true;
    // 막 시작한 변환은 처음 BURST초를 몰아서 만드니 그 안의 조각은 곧 나온다 (뒤처진 접속자 때문에 뒤에서 시작했을 때 서로 옮기지 않게)
    return Date.now() - r.at < YOUNG && this.segStart(k) - this.segStart(Math.min(r.next, this.starts.length - 1)) <= BURST - 5;
  }

  // 함께 보는 중에는 재생 위치에서 동떨어진 요청(한참 뒤처진 접속자 등) 때문에 공용 변환을 옮기지 않는다
  _mayRestart(k) {
    const pos = this.mgr.getPos(this.id);
    if (pos == null || !this.run) return true;
    const t = this.segStart(k), f = this.segAt(pos);
    return (t >= pos - LAG && t <= pos + AHEAD) || (!this.files.has(f) && !this._covers(f));
  }

  _start(k) {
    this._kill();
    if (this.stopped || Date.now() < this.blockedUntil) return;
    fs.mkdirSync(this.dir, { recursive: true });
    const n = ++this.runNo;
    const ac = new AbortController();
    const r = { n, from: k, next: k, until: this.conv.v === 'copy' ? k + BATCH : this.conv.v === 'encode' ? k + BATCH_ENC : Infinity, at: Date.now(), got: 0, hw: this.conv.v === 'encode' && this.hw, ac };
    this.run = r;
    const prefix = `r${n}_`;
    const p = run(TOOLS.ffmpeg, this._args(k, prefix, r.hw), {
      signal: ac.signal,
      // segment 목록(csv): 파일이름,시작,끝 (끝 = 다음 조각 시작, 파일 시각). 멈춘 변환이 뒤늦게 남긴 줄은 버린다
      onLine: (l) => {
        const m = l.match(/r(\d+)_(\d+)\.ts,[\d.]+,([\d.]+)/);
        if (m && +m[1] === n) this._done(r, +m[2], path.join(this.dir, `${prefix}${m[2]}.ts`), +m[3]);
      },
    });
    this._settle();
    p.then((res) => {
      if (this.run === r) this.run = null;
      if (ac.signal.aborted || this.stopped) return;
      if (res.code === 0) this.eof = Math.min(this.eof, r.next);   // 원본 끝까지 다 만듦
      else if (r.hw && !r.got) {
        // GPU 디코딩이 이 파일에서 안 되면 CPU로 바로 다시
        this.hw = false;
        this.mgr.log(`바로 재생: ${path.basename(this.file)} GPU 디코딩 실패, CPU로 다시 시작`);
        return this._start(r.from);
      } else {
        this.fails++;
        this.blockedUntil = Date.now() + Math.min(30000, 1000 * 2 ** this.fails);
        this.mgr.log(`바로 재생 변환 오류 (${path.basename(this.file)} ${Math.round(this.segStart(k))}초~, ${this.fails}번째): ${errText(res.stderr)}`);
      }
      this._settle();
    });
  }

  _kill() {
    if (!this.run) return;
    this.run.ac.abort();
    this.run = null;
  }

  _done(r, k, file, end) {
    if (this.stopped || r.bad || this.run !== r) return;
    // 조각 끝이 재생목록의 다음 조각 시작과 다르면 찾아가기가 다른 키프레임에 떨어진 것 → 버리고 보정해서 다시
    // (끝은 마지막 영상 프레임 기준이라 경계 앞에 프레임이 빠진 구간(VFR·방송 끊김)이면 조금 일찍 끝날 수 있다.
    //  영상 복사에서 다른 키프레임에서 잘렸으면 끝이 그 키프레임과 같으므로 그때만 어긋난 것으로 본다)
    if (k + 1 < this.starts.length && Math.abs(end - this.starts[k + 1]) > 0.25) {
      if (this.conv.v === 'copy' && this._nearKeyframe(end)) return this._misaligned(r, k, file, end);
      // 변환은 강제 키프레임마다 자르므로 보통 정확하다 — 기록만 남기고 그대로 쓴다
      if (!this.warned) { this.warned = true; this.mgr.log(`바로 재생: ${path.basename(this.file)} ${k}번 조각 경계가 어긋남 (${end.toFixed(3)} ≠ ${this.starts[k + 1].toFixed(3)}), 그대로 씀`); }
    }
    if (!this.files.has(k)) this.files.set(k, file);
    r.next = Math.max(r.next, k + 1);
    r.got++;
    this.fails = 0;
    if (r.next >= r.until || r.next >= this.eof) this._kill();   // 넘겨준 자르기 위치를 다 씀 → tick이 이어서 다시 시작
    for (const w of this.waiters.get(k) || []) { clearTimeout(w.timer); w.res(file); }
    this.waiters.delete(k);
    if (!this.run) this._settle();
  }

  _misaligned(r, k, file, end) {
    r.bad = true;
    this._kill();
    fs.rm(file, { force: true }, () => {});
    const retry = this.misaligned++ < 1;
    this.mgr.log(`바로 재생: ${path.basename(this.file)} ${k}번 조각 경계가 어긋남 (${end.toFixed(3)} ≠ ${this.starts[k + 1].toFixed(3)}), ${retry ? '찾아가기 보정을 바꿔' : '같은 경계로 변환해서'} 다시 시작`);
    if (retry) this.sk = this.sk ? 0 : SEEK_BACKOFF;
    // 영상 복사로 경계를 못 맞추면 같은 경계(키프레임 위치)로 변환해서 보낸다 (이미 보낸 재생목록은 그대로 유효)
    else this.conv.v = 'encode';
    this._start(r.from);
  }

  // 변환을 새로 시작했거나 끝났을 때: 지금 변환이 만들어 줄 수 없는 대기 요청은 돌려보낸다 (클라이언트가 다시 요청)
  _settle() {
    for (const [k, list] of [...this.waiters]) {
      if (this.files.has(k) || this._willMake(k)) continue;
      for (const w of list) { clearTimeout(w.timer); w.rej(httpErr(k >= this.eof ? 404 : 503)); }
      this.waiters.delete(k);
    }
  }

  _args(k, prefix, hw) {
    const c = this.conv;
    const t0 = this.segStart(k);
    const a = ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-readrate', String(READRATE), '-readrate_initial_burst', String(BURST)];
    if (hw) a.push('-hwaccel', 'cuda');
    // 영상 복사: 키프레임 바로 뒤로 찾아가면 그 키프레임부터 들어간다 / 변환: 정확히 그 시각부터.
    // 맨 앞(0초)에서도 -ss를 줘야 실행마다 시각 기준이 같다
    a.push('-ss', (c.v === 'copy' && k > 0 ? t0 + 0.001 + this.sk : t0).toFixed(6));
    if (c.v === 'copy') a.push('-noaccurate_seek');   // 소리를 변환할 때 찾아간 시각(보정값 포함)에서 잘라 내지 않고 키프레임 위치부터
    a.push('-i', this.file, '-copyts', '-start_at_zero');
    if (c.vi != null) a.push('-map', `0:${c.vi}`);
    if (c.ai != null) a.push('-map', `0:${c.ai}`);
    a.push('-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1');
    if (c.v === 'copy') a.push('-c:v', 'copy');
    else if (c.v === 'encode') a.push(...this._venc(k));
    if (c.a === 'copy') a.push('-c:a', 'copy');
    else if (c.a === 'encode') a.push('-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-ar', '48000');
    // 맨 앞에서 시작한 실행만 B프레임의 음수 DTS 때문에 시각이 밀리면 실행끼리 어긋나므로 segment와 안쪽 mpegts 먹서 모두에서 끈다
    // (mpegts가 1.4초를 더하므로 음수로 나가지 않음)
    a.push('-avoid_negative_ts', 'disabled', '-max_muxing_queue_size', '4096', '-f', 'segment', '-segment_format', 'mpegts', '-segment_format_options', 'avoid_negative_ts=disabled');
    // 다음 조각들의 시작에서 자른다.
    // 영상 복사: segment 먹서는 이번 실행의 첫 영상 패킷(k>0이면 t0의 키프레임, 0초부터면 영상 시작)을 0으로 보고
    //   "키프레임 ≥ 시각 - delta"에서 자른다 (MP4 시각 반올림 때문에 2ms 여유)
    // 변환: 키프레임은 _venc가 조각 시작(파일 시각)에만 넣으므로 키프레임마다 자른다 (TS처럼 찾아간 뒤 첫 프레임이 늦게 나와도 경계가 그대로)
    if (c.v === 'copy') {
      const base = k > 0 ? t0 : c.vs || 0;
      const times = this.starts.slice(k + 1, k + 1 + BATCH).map((t) => (t - base).toFixed(4));
      if (times.length) a.push('-segment_times', times.join(','), '-segment_time_delta', '0.002');
      else a.push('-segment_time', '86400');
    } else if (c.v === 'encode') a.push('-segment_time', '0.01', '-segment_time_delta', '0');
    else a.push('-segment_time', String(SEG), '-segment_time_delta', '0');
    a.push('-segment_start_number', String(k), '-segment_list', 'pipe:1', '-segment_list_type', 'csv',
      path.join(this.dir.replace(/%/g, '%%'), `${prefix}%d.ts`));
    return a;
  }

  _venc(k) {
    const vf = [`scale=-2:'2*trunc(min(ih,${this.height})/2)'`];
    // HDR(PQ·HLG) → SDR. 원색·행렬이 비어 있는 파일도 있어 BT.2020으로 정해 준다 (규격상 HDR은 BT.2020)
    if (this.conv.hdr) vf.push('zscale=pin=bt2020:p=bt2020:min=bt2020nc:t=linear:npl=100', 'format=gbrpf32le', 'zscale=p=bt709', 'tonemap=tonemap=hable:desat=0', 'zscale=t=bt709:m=bt709:r=tv');
    vf.push('format=yuv420p');
    // 조각 시작마다 IDR. 목록 형식은 (-copyts에서) 파일 시각과 비교하므로 실행마다 같은 프레임에서 끊긴다.
    // 키프레임마다 자르므로 장면 전환·주기 키프레임은 끈다. 이번 묶음의 마지막 조각을 닫는 경계(k+BATCH_ENC)까지 넣는다
    const kf = this.starts.slice(k, k + BATCH_ENC + 1).map((t) => Math.max(0, t - 0.0005).toFixed(4)).join(',');
    const common = ['-fps_mode', 'passthrough', '-vf', vf.join(','), '-maxrate', '8M', '-bufsize', '16M', '-g', '9999', '-force_key_frames', kf];
    if (this.nvenc) return [...common, '-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '23', '-b:v', '0', '-profile:v', 'high', '-forced-idr', '1'];
    return [...common, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-profile:v', 'high', '-sc_threshold', '0'];
  }

  tick() {
    if (this.stopped) return;
    if (!this.starts) { if (this.failedAt && Date.now() - this.failedAt > IDLE) this.mgr.stop(this.id); return; }
    const pos = this.mgr.getPos(this.id);
    if (Date.now() - this.lastReq > (pos == null ? 15000 : IDLE)) return this.mgr.stop(this.id);
    const t = pos ?? this.segStart(this.lastSeg);
    const f = this.segAt(t);
    const r = this.run;
    if (r) {
      if (this.segStart(Math.min(r.next, this.starts.length - 1)) - t > AHEAD) { this._kill(); this._settle(); }   // 너무 앞섰음 (오래 일시정지)
      else if (pos != null && !this.files.has(f) && !this._covers(f)) this._start(f);                          // 관리자가 위치를 옮겼거나 변환이 재생을 못 따라감
    }
    // 앞쪽 여유가 줄면 첫 빈 조각부터 이어서 만든다
    if (!this.run) {
      let m = f;
      while (m < this.starts.length && this.files.has(m)) m++;
      if (m < this.starts.length && m < this.eof && this.segStart(m) - t < REFILL) this._start(m);
    }
    // 지나간 조각과 멈춘 변환이 남긴 미완성 조각 정리 (아직 파일을 쥐고 있으면 다음 번에)
    const keep = new Set();
    for (const [k, file] of this.files) {
      if (this.segEnd(k) < t - BEHIND) { this.files.delete(k); fs.rm(file, { force: true }, () => {}); }
      else keep.add(path.basename(file));
    }
    const cur = this.run ? `r${this.run.n}_` : null;
    for (const file of listDir(this.dir)) {
      const b = path.basename(file);
      if (!keep.has(b) && !(cur && b.startsWith(cur))) fs.rm(file, { force: true }, () => {});
    }
  }

  stop() {
    this.stopped = true;
    this._kill();
    for (const list of this.waiters.values()) for (const w of list) { clearTimeout(w.timer); w.rej(httpErr(503)); }
    this.waiters.clear();
    this.files.clear();
    rmLater(this.dir);
  }
}

function outHeight(settings) { return Math.min(+settings?.maxHeight || 1080, 1080); }
function httpErr(status) { const e = new Error('segment ' + status); e.status = status; return e; }
function listDir(dir) { try { return fs.readdirSync(dir).map((f) => path.join(dir, f)); } catch { return []; } }
// ffmpeg 오류 출력에서 원인 줄만 (마지막 줄들은 "Terminating thread…" 같은 뒷정리 메시지)
function errText(s) {
  const lines = String(s || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).filter((l) => !/Terminating thread|Conversion failed|Nothing was written|Error while (filtering|processing)/i.test(l));
  return (lines.filter((l) => /error|invalid|failed|unsupported|cannot|no path/i.test(l)).slice(0, 2).join(' / ') || lines.slice(-2).join(' / ')).slice(0, 300);
}
// 방금 멈춘 ffmpeg가 파일을 쥐고 있으면 지워지지 않으므로 잠시 뒤 다시 시도
function rmLater(dir, n = 0) {
  fs.rm(dir, { recursive: true, force: true }, (e) => { if (e && n < 5) setTimeout(() => rmLater(dir, n + 1), 2000); });
}

module.exports = { LiveManager, livePlan, rmLater };
