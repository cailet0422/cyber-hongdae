// 키프레임 색인: 컨테이너에 들어 있는 색인(MKV Cues / MP4 stss)만 읽어 영상 키프레임 시각(초)을 구한다.
// 파일 전체를 훑지 않고 헤더·색인 위치만 골라 읽는다 (50GB 넘는 파일도 금방). 조금이라도 이상하면 null.
// 시각은 ffmpeg/ffprobe가 그 영상 스트림 패킷에 매기는 pts_time과 같다 (-copyts로 내보낼 때의 값)
const fs = require('fs');

const MAX_BOX = 64 * 1024 * 1024;      // Cues·moov 최대 크기
const MAX_TOTAL = 160 * 1024 * 1024;   // 파일 하나에서 읽는 총량 상한
const MAX_WALK = 20000;                // 최상위 요소를 하나씩 건너뛰며 훑는 횟수 상한
const WALK_MS = 4000;                  // 〃 시간 상한 (HDD에서 수천 번 위치 이동하지 않게)
const MAX_SAMPLES = 5000000;           // MP4 영상 샘플 수 상한

// file: 원본 경로, format: ffprobe format.format_name, videoOrdinal: 몇 번째 영상 트랙인지 (표지 그림 제외, 0 = v:0)
// → { times: [초, 오름차순·중복 없음], source: 'mkv-cues' | 'mp4-stss', codec } | null
async function keyframeIndex(file, { format = '', videoOrdinal = 0 } = {}) {
  let fh = null;
  try {
    if (!Number.isInteger(videoOrdinal) || videoOrdinal < 0) return null;
    fh = await fs.promises.open(file, 'r');
    const r = reader(fh, (await fh.stat()).size);
    const head = await r.read(0, 8);
    if (head.length < 8) return null;
    const fmt = String(format || '');
    let res = null;
    if (head.readUInt32BE(0) === 0x1a45dfa3) {
      if (!fmt || /matroska|webm/.test(fmt)) res = await mkvIndex(r, videoOrdinal);
    } else if (/^(ftyp|moov|mdat|free|skip|wide|pnot|junk|uuid)$/.test(head.toString('latin1', 4, 8))) {
      if (!fmt || /mov|mp4/.test(fmt)) res = await mp4Index(r, videoOrdinal);
    }
    if (!res || !res.times.length || !res.times.every(Number.isFinite)) return null;
    const times = res.times.sort((a, b) => a - b).filter((x, i, a) => !i || x - a[i - 1] > 1e-9);
    return { ...res, times };
  } catch {
    return null;
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

// 위치 지정 읽기 (4GB 넘는 위치도 Number로 충분). 읽은 총량을 제한한다
function reader(fh, size) {
  let total = 0;
  return {
    size,
    async read(pos, len) {
      len = Math.max(0, Math.min(len, size - pos));
      if ((total += len) > MAX_TOTAL) throw new Error('읽기 상한');
      const buf = Buffer.allocUnsafe(len);
      let got = 0;
      while (got < len) {
        const { bytesRead } = await fh.read(buf, got, len - got, pos + got);
        if (!bytesRead) break;
        got += bytesRead;
      }
      return buf.subarray(0, got);
    },
  };
}

// ------------------------------------------------------------ Matroska / WebM
const ID = {
  EBML: 0x1a45dfa3, DOCTYPE: 0x4282, SEGMENT: 0x18538067, SEEKHEAD: 0x114d9b74, SEEK: 0x4dbb, SEEKID: 0x53ab, SEEKPOS: 0x53ac,
  INFO: 0x1549a966, TSCALE: 0x2ad7b1, TRACKS: 0x1654ae6b, TRACK: 0xae, TNUM: 0xd7, TTYPE: 0x83, CODEC: 0x86, TTSCALE: 0x23314f,
  CDELAY: 0x56aa, CUES: 0x1c53bb6b, CUEPOINT: 0xbb, CUETIME: 0xb3, CUEPOS: 0xb7, CUETRACK: 0xf7, CLUSTER: 0x1f43b675,
};
// Segment 바로 아래에 올 수 있는 요소 (Chapters, Tags, Attachments, Void, CRC-32 포함). 모르는 게 나오면 훑기 중단
const TOP = new Set([ID.SEEKHEAD, ID.INFO, ID.TRACKS, ID.CUES, ID.CLUSTER, 0x1043a770, 0x1254c367, 0x1941a469, 0xec, 0xbf]);

// EBML 가변 길이 정수 → { v, n(바이트 수), unk(크기 모름: 값 비트가 전부 1) }. id는 표식 비트를 남긴다
function vint(b, o, isId) {
  if (o >= b.length || !b[o]) return null;
  const n = Math.clz32(b[o]) - 23;
  if (n > (isId ? 4 : 8) || o + n > b.length) return null;
  const mask = 0xff >> n;
  let v = isId ? b[o] : b[o] & mask;
  let unk = !isId && v === mask;
  for (let i = 1; i < n; i++) {
    v = v * 256 + b[o + i];
    if (b[o + i] !== 0xff) unk = false;
  }
  if (!unk && v > Number.MAX_SAFE_INTEGER) return null;
  return { v, n, unk };
}
// 요소 머리 → { id, d(내용 시작), e(끝, 크기 모름이면 -1) } — o와 같은 기준의 위치
function elem(b, o) {
  const id = vint(b, o, true);
  const sz = id && vint(b, o + id.n, false);
  if (!sz) return null;
  const d = o + id.n + sz.n;
  return { id: id.v, d, e: sz.unk ? -1 : d + sz.v };
}
// 마스터 요소 안의 자식들. 크기가 어긋나면 throw (→ null)
function* kids(b, d, e) {
  for (let o = d; o < e;) {
    const k = elem(b, o);
    if (!k || k.e < 0 || k.e > e) throw new Error('EBML 구조 오류');
    yield k;
    o = k.e;
  }
}
function uint(b, k) {
  if (k.e - k.d > 8) throw new Error('EBML 정수 길이');
  let v = 0;
  for (let i = k.d; i < k.e; i++) v = v * 256 + b[i];
  if (v > Number.MAX_SAFE_INTEGER) throw new Error('EBML 정수 범위');
  return v;
}
const float = (b, k) => (k.e - k.d === 4 ? b.readFloatBE(k.d) : k.e - k.d === 8 ? b.readDoubleBE(k.d) : k.e === k.d ? 0 : NaN);

async function mkvIndex(r, ordinal) {
  const b = await r.read(0, 1024);
  const h = elem(b, 0);
  if (!h || h.id !== ID.EBML || h.e < 0 || h.e + 12 > b.length) return null;
  for (const k of kids(b, h.d, h.e)) {
    if (k.id === ID.DOCTYPE && !/^(matroska|webm)\0*$/.test(b.toString('latin1', k.d, k.e))) return null;
  }
  const s = elem(b, h.e);
  if (!s || s.id !== ID.SEGMENT) return null;
  const seg = s.d;                                          // SeekPosition 기준점
  const segEnd = s.e < 0 ? r.size : Math.min(r.size, s.e);  // 크기 모르는 Segment(0x01FFFFFFFFFFFFFF)면 파일 끝까지
  const got = new Map();       // Info/Tracks/Cues → 내용 Buffer
  const visited = new Set();
  const seeks = [];            // SeekHead 항목 [id, 절대 위치]

  // pos에 있는 요소의 머리만 읽기 (id 4 + 크기 8바이트면 충분)
  const at = async (pos) => {
    const x = elem(await r.read(pos, 12), 0);
    return x && { id: x.id, pos, d: pos + x.d, e: x.e < 0 ? -1 : pos + x.e };
  };
  // 필요한 요소면 내용까지 읽는다. SeekHead면 항목을 모아 둔다
  const take = async (el) => {
    if (visited.has(el.pos)) return;
    visited.add(el.pos);
    if (el.id !== ID.SEEKHEAD && el.id !== ID.INFO && el.id !== ID.TRACKS && el.id !== ID.CUES) return;
    if (got.has(el.id)) return;
    if (el.e < 0 || el.e > segEnd || el.e - el.d > MAX_BOX) throw new Error('요소 크기');
    const buf = await r.read(el.d, el.e - el.d);
    if (buf.length !== el.e - el.d) throw new Error('파일 잘림');
    if (el.id !== ID.SEEKHEAD) return void got.set(el.id, buf);
    for (const k of kids(buf, 0, buf.length)) {
      if (k.id !== ID.SEEK) continue;
      let id = 0, p = -1;
      for (const c of kids(buf, k.d, k.e)) {
        if (c.id === ID.SEEKID) id = uint(buf, c);
        else if (c.id === ID.SEEKPOS) p = uint(buf, c);
      }
      if (p >= 0) seeks.push([id, seg + p]);
    }
  };
  // 최상위 요소를 크기대로 건너뛰며 훑는다. toCluster면 첫 Cluster에서, 아니면 Cues를 찾으면 멈춤
  let pos = seg, steps = 0;
  const until = Date.now() + WALK_MS;
  const walk = async (toCluster) => {
    while (pos < segEnd && ++steps <= MAX_WALK && Date.now() < until) {
      const el = await at(pos);
      if (!el || !TOP.has(el.id)) return false;
      if (el.id === ID.CLUSTER && toCluster) return true;
      await take(el);
      if (el.e < 0 || (!toCluster && got.has(ID.CUES))) return false;  // 크기 모르는 Cluster(생방송형)면 포기
      pos = el.e;
    }
    return false;
  };
  // SeekHead가 가리키는 곳 (다른 SeekHead를 가리키면 그것도 따라감)
  const follow = async () => {
    for (let i = 0; i < seeks.length && i < 1000; i++) {
      const [id, p] = seeks[i];
      if (![ID.SEEKHEAD, ID.INFO, ID.TRACKS, ID.CUES].includes(id) || visited.has(p) || p < seg || p >= segEnd) continue;
      if (id !== ID.SEEKHEAD && got.has(id)) continue;
      const el = await at(p);
      if (el && el.id === id) await take(el);
    }
  };

  const atCluster = await walk(true);   // 1) 첫 Cluster 앞까지 (SeekHead·Info·Tracks, 앞쪽 Cues)
  await follow();                       // 2) SeekHead → 뒤쪽 Cues 등
  if (!got.has(ID.CUES) && atCluster) { // 3) SeekHead에 Cues가 없으면 Cluster들을 크기대로 건너뛰며 찾는다
    await walk(false);
    await follow();
  }
  const info = got.get(ID.INFO), tracks = got.get(ID.TRACKS), cues = got.get(ID.CUES);
  if (!info || !tracks || !cues) return null;

  let scale = 1000000;
  for (const k of kids(info, 0, info.length)) if (k.id === ID.TSCALE) scale = uint(info, k);
  if (!(scale > 0)) return null;
  const vids = [];
  for (const t of kids(tracks, 0, tracks.length)) {
    if (t.id !== ID.TRACK) continue;
    const tr = { num: 0, type: 0, codec: '', tscale: 1, delay: 0 };
    for (const k of kids(tracks, t.d, t.e)) {
      if (k.id === ID.TNUM) tr.num = uint(tracks, k);
      else if (k.id === ID.TTYPE) tr.type = uint(tracks, k);
      else if (k.id === ID.CODEC) tr.codec = tracks.toString('latin1', k.d, k.e).replace(/\0+$/, '');
      else if (k.id === ID.TTSCALE) tr.tscale = float(tracks, k);
      else if (k.id === ID.CDELAY) tr.delay = uint(tracks, k);
    }
    if (tr.type === 1 && tr.codec) vids.push(tr);  // ffmpeg도 CodecID 없는 트랙은 스트림으로 만들지 않는다
  }
  const tr = vids[ordinal];
  // TrackTimestampScale(옛 기능)이 1이 아니거나, VfW 호환 트랙(블록 시각이 dts)이면 믿지 않는다
  if (!tr || !tr.num || !(tr.tscale === 1 || tr.tscale < 0.01) || /^V_MS\/VFW/.test(tr.codec)) return null;
  const delay = tr.delay ? Math.round(tr.delay / scale) : 0;  // CodecDelay만큼 ffmpeg이 pts를 당긴다

  const times = [];
  for (const p of kids(cues, 0, cues.length)) {
    if (p.id !== ID.CUEPOINT) continue;
    let t = -1, mine = false;
    for (const k of kids(cues, p.d, p.e)) {
      if (k.id === ID.CUETIME) t = uint(cues, k);
      else if (k.id === ID.CUEPOS) for (const c of kids(cues, k.d, k.e)) if (c.id === ID.CUETRACK && uint(cues, c) === tr.num) mine = true;
    }
    if (mine && t >= 0) times.push((t - delay) * scale / 1e9);
  }
  return { times, source: 'mkv-cues', codec: tr.codec };
}

// ------------------------------------------------------------ MP4 / MOV
// 상자 목록 { type, d(내용 시작), e(끝) }. 크기가 어긋나면 throw (→ null)
function* boxes(b, d, e) {
  for (let o = d; o + 8 <= e;) {
    let size = b.readUInt32BE(o), hl = 8;
    if (size === 1) { size = Number(b.readBigUInt64BE(o + 8)); hl = 16; }
    else if (size === 0) size = e - o;
    if (size < hl || o + size > e) throw new Error('상자 구조 오류');
    yield { type: b.toString('latin1', o + 4, o + 8), d: o + hl, e: o + size };
    o += size;
  }
}
const child = (b, k, type) => { for (const c of boxes(b, k.d, k.e)) if (c.type === type) return c; return null; };
// 항목 수 + 고정 길이 항목 표 → { n, o(첫 항목 위치) }. 상자를 넘치면 throw
function table(b, k, size) {
  const n = b.readUInt32BE(k.d + 4);
  if (k.d + 8 + n * size > k.e) throw new Error('표 크기');
  return { n, o: k.d + 8 };
}

async function mp4Index(r, ordinal) {
  // 최상위 상자를 건너뛰며 moov 찾기 (앞이든 뒤든). moof가 먼저 보이면 조각 MP4
  let moov = null;
  for (let pos = 0, i = 0; !moov && pos + 8 <= r.size && i < 10000; i++) {
    const h = await r.read(pos, 16);
    let size = h.readUInt32BE(0), hl = 8;
    const type = h.toString('latin1', 4, 8);
    if (size === 1) { size = Number(h.readBigUInt64BE(8)); hl = 16; }
    else if (size === 0) size = r.size - pos;
    if (size < hl) return null;
    if (type === 'moof') return null;
    if (type === 'moov') {
      if (size - hl > MAX_BOX || pos + size > r.size) return null;
      moov = await r.read(pos + hl, size - hl);
    }
    pos += size;
  }
  if (!moov) return null;
  let mts = 0;
  const traks = [];
  for (const k of boxes(moov, 0, moov.length)) {
    if (k.type === 'mvex') return null;  // 조각 MP4 (색인이 moof마다 흩어져 있음)
    if (k.type === 'mvhd') mts = moov.readUInt32BE(k.d + (moov[k.d] === 1 ? 20 : 12));
    else if (k.type === 'trak') traks.push(trak(moov, k));
  }
  // QuickTime 챕터 그림 트랙은 ffmpeg이 표지(attached_pic)로 다루므로 순번에서 뺀다
  const chap = new Set(traks.flatMap((t) => t.chap));
  const t = traks.filter((x) => x.handler === 'vide' && !chap.has(x.id))[ordinal];
  if (!t || !t.stbl || !(t.ts > 0)) return null;
  return mp4Times(moov, t, mts);
}

function trak(b, t) {
  const o = { id: 0, handler: '', chap: [], elst: null, ts: 0, stbl: null };
  for (const k of boxes(b, t.d, t.e)) {
    if (k.type === 'tkhd') o.id = b.readUInt32BE(k.d + (b[k.d] === 1 ? 20 : 12));
    else if (k.type === 'tref') { const c = child(b, k, 'chap'); if (c) for (let i = c.d; i + 4 <= c.e; i += 4) o.chap.push(b.readUInt32BE(i)); }
    else if (k.type === 'edts') o.elst = child(b, k, 'elst');
    else if (k.type === 'mdia') {
      for (const m of boxes(b, k.d, k.e)) {
        if (m.type === 'mdhd') o.ts = b.readUInt32BE(m.d + (b[m.d] === 1 ? 20 : 12));
        else if (m.type === 'hdlr') o.handler = b.toString('latin1', m.d + 8, m.d + 12);
        else if (m.type === 'minf') o.stbl = child(b, m, 'stbl');
      }
    }
  }
  return o;
}

// 표본 표 → 키프레임 pts. ffmpeg mov 디먹서(mov_build_index + mov_fix_index)의 계산을 그대로 따라 한다
function mp4Times(b, t, mts) {
  const tab = {};
  for (const k of boxes(b, t.stbl.d, t.stbl.e)) {
    if (k.type === 'sbgp' && b.toString('latin1', k.d + 4, k.d + 8) === 'rap ') return null;  // ffmpeg이 키프레임 표시로 쓰는 그룹
    if (!tab[k.type]) tab[k.type] = k;
    else if (/^(stsd|stts|ctts|stss|stps|stsz|stz2|stsc|stco|co64)$/.test(k.type)) return null;  // 중복 표
  }
  const sz = tab.stsz || tab.stz2, co = tab.stco || tab.co64;
  // stss가 없으면 "모든 표본이 키프레임"이라는 뜻이지만 H.264에서 그럴 리 없으니(대개 잘못 만든 파일) 믿지 않는다
  if (!sz || !co || !tab.stsc || !tab.stts || !tab.stss || !tab.stsd) return null;
  const codec = b.readUInt32BE(tab.stsd.d + 4) ? b.toString('latin1', tab.stsd.d + 12, tab.stsd.d + 16) : '';

  // 표본 수: stsz와 stsc·stco로 센 값이 같아야 한다 (ffmpeg 색인 개수)
  const n = b.readUInt32BE(sz.d + 8);
  const stsc = table(b, tab.stsc, 12), chunks = table(b, co, co === tab.co64 ? 8 : 4).n;
  let total = 0;
  for (let i = 0; i < stsc.n; i++) {
    const p = stsc.o + i * 12, first = b.readUInt32BE(p), per = b.readUInt32BE(p + 4);
    const next = i + 1 < stsc.n ? b.readUInt32BE(p + 12) : chunks + 1;
    if (per < 1 || next <= first || (i === 0 && first !== 1)) return null;
    total += Math.max(0, Math.min(next, chunks + 1) - first) * per;
  }
  if (total !== n || n < 1 || n > MAX_SAMPLES) return null;

  // 표시 시각 차(ctts, 음수 가능). ffmpeg처럼 표본마다 펼치고, 음수면 dts_shift를 구한다 (마지막 두 항목은 빼고)
  let ct = null, ctN = 0, shift = 0;
  if (tab.ctts) {
    const c = table(b, tab.ctts, 8);
    ct = new Int32Array(n);
    for (let i = 0; i < c.n; i++) {
      const p = c.o + i * 8, cnt = b.readInt32BE(p), off = b.readInt32BE(p + 4);
      if (cnt <= 0) continue;
      if (Math.abs(off) > 1 << 28 && i + 2 < c.n) return null;  // ffmpeg은 이런 ctts를 통째로 버린다
      for (let j = 0; j < cnt && ctN < n; j++) ct[ctN++] = off;
      if (i + 2 < c.n && off < 0) shift = Math.max(shift, off === -0x80000000 ? 0x7fffffff : -off);
    }
    if (!ctN) return null;
  }
  // 복호 시각(dts): stts. ffmpeg 9는 색인 dts를 -dts_shift에서 시작한다 (그래서 pts = dts + dts_shift + ctts = 원래 dts + ctts. 실측 확인)
  const stts = table(b, tab.stts, 8);
  if (!stts.n) return null;
  const dts = new Float64Array(n);
  for (let i = 0, idx = 0, cnt = 0, cur = -shift; i < n; i++) {
    const p = stts.o + idx * 8, delta = b.readUInt32BE(p + 4);
    if (delta >= 0x80000000) return null;
    dts[i] = cur;
    cur += delta;
    if (idx + 1 < stts.n && ++cnt === b.readUInt32BE(p)) { cnt = 0; idx++; }
  }
  // 키프레임: stss (+ stps 부분 동기 표본)
  const stss = table(b, tab.stss, 4), stps = tab.stps ? table(b, tab.stps, 4) : { n: 0 };
  if (!stss.n) return null;  // 빈 stss면 ffmpeg은 파서로 키프레임을 다시 찾는다 → 색인만으로는 알 수 없음
  const ss = (i) => b.readUInt32BE(stss.o + i * 4), ps = (i) => b.readUInt32BE(stps.o + i * 4);
  const off = ss(0) > 0 || (stps.n && ps(0) > 0) ? 1 : 0;
  const key = new Uint8Array(n);
  for (let i = 0, si = 0, pi = 0; i < n; i++) {
    if (i + off === ss(si)) { key[i] = 1; if (si + 1 < stss.n) si++; }
    else if (stps.n && i + off === ps(pi)) { key[i] = 1; if (pi + 1 < stps.n) pi++; }
  }
  // 편집 목록: 앞쪽 빈 편집(들) + 보통 편집 1개만 받는다
  let edits = null;
  if (t.elst) {
    const v = b[t.elst.d], es = v === 1 ? 20 : 12, e = table(b, t.elst, es);
    edits = [];
    for (let i = 0; i < e.n; i++) {
      const p = e.o + i * es;
      const dur = v === 1 ? Number(b.readBigUInt64BE(p)) : b.readUInt32BE(p);
      const time = v === 1 ? Number(b.readBigInt64BE(p + 8)) : b.readInt32BE(p + 4);
      if (b.readUInt32BE(p + es - 4) !== 0x10000 || (time < 0 && time !== -1) || dur > Number.MAX_SAFE_INTEGER || time > Number.MAX_SAFE_INTEGER) return null;
      edits.push({ dur, time });
    }
    if (!edits.length) edits = null;
  }

  // 새 색인: S[j] = 표본 번호, TS[j] = 그 표본의 dts (ffmpeg이 편집 목록을 적용한 뒤의 값)
  const S = new Int32Array(n), TS = new Float64Array(n);
  let m = 0;
  if (!edits) {
    for (let s = 0; s < n; s++) { S[m] = s; TS[m++] = dts[s]; }
  } else {
    if (!(mts > 0)) return null;
    const rescale = (x) => Number((BigInt(x) * BigInt(t.ts) + BigInt(mts) / 2n) / BigInt(mts));  // 영화 단위 → 트랙 단위 (반올림)
    let counter = -shift, empty = 0, i = 0;
    for (; i < edits.length && edits[i].time === -1; i++) { const du = rescale(edits[i].dur); counter += du; empty += du; }
    if (i !== edits.length - 1) return null;
    const M = edits[i].time, D = rescale(edits[i].dur);
    if (!(D > 0)) return null;
    // 편집 시작(M)보다 앞서는 가장 가까운 키프레임부터 (find_prev_closest_index)
    const want = M - shift;
    const findPrev = (any) => {
      let a = -1, z = n;
      if (dts[n - 1] < want) a = n - 1;
      while (z - a > 1) { const mid = (a + z) >> 1; if (dts[mid] >= want) z = mid; if (dts[mid] <= want) a = mid; }
      let idx = a;
      if (!any) while (idx >= 0 && !key[idx]) idx--;
      if (idx >= 0) for (let j = idx; j > 0 && dts[j] === dts[j - 1]; j--) if (any || key[j - 1]) idx = j - 1;
      if (ct && idx >= 0) {
        for (let ti = Math.min(idx, ctN); idx >= 0 && ti >= 0 && ti < ctN; idx--, ti--) if (dts[idx] + ct[ti] <= want && key[idx]) break;
      }
      return idx;
    };
    let s = findPrev(false);
    if (s < 0) s = findPrev(true);
    if (s < 0) s = 0;
    let started = false, after = false, mcp = -1;
    const disc = [];  // 편집 시작 전에 버려지는 표본들의 길이 → 처음 보이는 표본 기준으로 거꾸로 dts를 다시 매긴다
    for (; s < n; s++) {
      const fd = s + 1 < n ? dts[s + 1] - dts[s] : D;
      const cc = s < ctN ? ct[s] : 0;
      const cts = dts[s] + shift + cc;
      if (cts < M || cts >= M + D) {
        if (!started) disc.push(fd);
      } else {
        const v = counter + cc + shift;
        mcp = mcp < 0 ? v : Math.min(mcp, v);
        if (!started) {
          started = true;
          for (let j = 0, x = counter; j < disc.length; j++) TS[m - 1 - j] = x -= disc[disc.length - 1 - j];
        }
      }
      S[m] = s;
      TS[m++] = counter;
      if (started) counter += fd;
      // 편집이 끝난 뒤 첫 키프레임에서 멈춤 (ctts가 있으면 뒤따르는 B프레임 때문에 하나 더 기다림)
      if (cts + fd >= M + D && key[s]) {
        if (ct && !after) { after = true; continue; }
        break;
      }
    }
    if (!started) return null;  // 편집 구간에 들어가는 표본이 하나도 없음
    // 첫 pts가 0(또는 빈 편집 길이)이 되도록 전체를 당긴다
    mcp -= empty;
    if (mcp > 0) for (let j = 0; j < m; j++) TS[j] -= mcp;
  }

  const times = [];
  for (let j = 0; j < m; j++) {
    const s = S[j];
    if (key[s]) times.push((TS[j] + (s < ctN ? shift + ct[s] : 0)) / t.ts);
  }
  return { times, source: 'mp4-stss', codec };
}

module.exports = { keyframeIndex };
