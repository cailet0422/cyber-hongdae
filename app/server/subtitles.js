// 자막 파서: SRT / VTT / SMI(SAMI) / ASS·SSA → 공통 큐 배열
// 큐 형식: { s, e (초), text, an(1~9 정렬, 기본 2), pos:[x,y](0~1, 선택), color, outline, size(화면높이 대비), bold, italic, layer }
const iconv = require('iconv-lite');

function decodeText(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.slice(3).toString('utf8');
  if (buf[0] === 0xff && buf[1] === 0xfe) return iconv.decode(buf.slice(2), 'utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) return iconv.decode(buf.slice(2), 'utf16be');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // 한국 자막(특히 SMI)은 대부분 CP949. 일본어가 많으면 Shift_JIS
    const kr = iconv.decode(buf, 'cp949');
    const bad = (kr.match(/�/g) || []).length;
    if (bad > 10) {
      const jp = iconv.decode(buf, 'shift_jis');
      if ((jp.match(/�/g) || []).length < bad) return jp;
    }
    return kr;
  }
}

const ENT = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeEntities(s) {
  return s
    .replace(/&#(\d+);?/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);?/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(nbsp|amp|lt|gt|quot|apos);?/gi, (_, n) => ENT[n.toLowerCase()]);
}

function htmlColor(c) {
  if (!c) return null;
  c = c.trim().replace(/["']/g, '');
  if (/^[0-9a-f]{6}$/i.test(c)) return '#' + c;
  return c;
}

// <i>, <b>, <font color> 같은 HTML 계열 태그 처리 (SRT/VTT/SMI 공용)
function htmlCue(raw) {
  let italic = /<i>/i.test(raw);
  let bold = /<b>/i.test(raw);
  const cm = raw.match(/<font[^>]*color\s*=\s*["']?([#\w]+)/i);
  let text = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\{\\an?\d\}/g, '')
    .replace(/<[^>]+>/g, '');
  text = decodeEntities(text).replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
  return { text, italic, bold, color: cm ? htmlColor(cm[1]) : null };
}

function tsToSec(t) {
  // 00:01:02,345 | 01:02.345 | 0:01:02.34
  const m = t.trim().replace(',', '.').split(':');
  let s = 0;
  for (const p of m) s = s * 60 + parseFloat(p);
  return s;
}

function parseSrtVtt(text) {
  const cues = [];
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/);
  for (const b of blocks) {
    const lines = b.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, rest] = lines[i].split('-->');
    const e = rest.trim().split(/\s+/)[0];
    const body = lines.slice(i + 1).join('\n');
    if (!body.trim()) continue;
    const anm = body.match(/\{\\an(\d)\}/);
    const c = htmlCue(body.replace(/<\d\d:[^>]+>/g, '').replace(/<\/?c[^>]*>/g, ''));
    if (!c.text) continue;
    cues.push({ s: tsToSec(a), e: tsToSec(e), ...c, an: anm ? +anm[1] : 2 });
  }
  return cues;
}

function parseSmi(text) {
  // 클래스(언어)별로 분리 → 한국어 우선
  const byClass = new Map();
  const re = /<sync[^>]*start\s*=\s*["']?(-?\d+)[^>]*>([\s\S]*?)(?=<sync|<\/body|$)/gi;
  let m;
  while ((m = re.exec(text))) {
    const start = +m[1] / 1000;
    const chunk = m[2];
    const ps = chunk.split(/<p\b/i).slice(1);
    const parts = ps.length ? ps.map((p) => '<p' + p) : ['<p class=DEFAULT>' + chunk];
    for (const p of parts) {
      const cls = ((p.match(/class\s*=\s*["']?([\w-]+)/i) || [])[1] || 'DEFAULT').toUpperCase();
      const body = p.replace(/^<p[^>]*>/i, '').replace(/<\/p>/gi, '');
      if (!byClass.has(cls)) byClass.set(cls, []);
      byClass.get(cls).push({ s: start, raw: body });
    }
  }
  if (!byClass.size) return [];
  const pref = ['KRCC', 'KOCC', 'KOKRCC', 'KORCC', 'KRC', 'KO', 'KOR'];
  let cls = pref.find((c) => byClass.has(c));
  if (!cls) cls = [...byClass.keys()].sort((a, b) => byClass.get(b).length - byClass.get(a).length)[0];
  const arr = byClass.get(cls).sort((a, b) => a.s - b.s);
  const cues = [];
  for (let i = 0; i < arr.length; i++) {
    const c = htmlCue(arr[i].raw);
    if (!c.text) continue;
    const e = i + 1 < arr.length ? arr[i + 1].s : arr[i].s + 5;
    if (e <= arr[i].s) continue;
    cues.push({ s: arr[i].s, e, ...c, an: 2 });
  }
  return cues;
}

function assColor(c) {
  // &HAABBGGRR 또는 &HBBGGRR
  if (!c) return null;
  const h = c.replace(/[&H]/gi, '').padStart(8, '0');
  const a = 255 - parseInt(h.slice(0, 2), 16);
  const b = h.slice(2, 4), g = h.slice(4, 6), r = h.slice(6, 8);
  return a >= 250 ? `#${r}${g}${b}` : `rgba(${parseInt(r, 16)},${parseInt(g, 16)},${parseInt(b, 16)},${(a / 255).toFixed(2)})`;
}

function parseAss(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  let section = '';
  let playResX = 384, playResY = 288;
  let styleFmt = null, eventFmt = null;
  const styles = {};
  const cues = [];
  for (const line of lines) {
    const t = line.trim();
    if (/^\[.*\]$/.test(t)) { section = t.toLowerCase(); continue; }
    if (section === '[script info]') {
      const m = t.match(/^PlayRes([XY])\s*:\s*(\d+)/i);
      if (m) m[1].toUpperCase() === 'X' ? (playResX = +m[2]) : (playResY = +m[2]);
    } else if (section.includes('styles')) {
      if (/^format:/i.test(t)) styleFmt = t.slice(7).split(',').map((s) => s.trim().toLowerCase());
      else if (/^style:/i.test(t) && styleFmt) {
        const v = t.slice(6).split(',');
        const st = {};
        styleFmt.forEach((k, i) => (st[k] = (v[i] || '').trim()));
        styles[st.name] = st;
      }
    } else if (section === '[events]') {
      if (/^format:/i.test(t)) eventFmt = t.slice(7).split(',').map((s) => s.trim().toLowerCase());
      else if (/^dialogue:/i.test(t) && eventFmt) {
        const raw = t.slice(9);
        const parts = [];
        let rest = raw;
        for (let i = 0; i < eventFmt.length - 1; i++) {
          const k = rest.indexOf(',');
          parts.push(rest.slice(0, k).trim());
          rest = rest.slice(k + 1);
        }
        parts.push(rest);
        const ev = {};
        eventFmt.forEach((k, i) => (ev[k] = parts[i]));
        const st = styles[ev.style] || styles.Default || styles.default || {};
        let body = ev.text || '';
        if (/\\p[1-9]/.test(body)) continue; // 벡터 드로잉은 건너뜀
        const tags = (body.match(/\{[^}]*\}/g) || []).join('');
        const an = tags.match(/\\an(\d)/) ? +tags.match(/\\an(\d)/)[1] : (tags.match(/\\a(\d+)/) ? legacyAlign(+tags.match(/\\a(\d+)/)[1]) : +(st.alignment || 2));
        const pm = tags.match(/\\pos\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/) || tags.match(/\\move\(\s*([-\d.]+)\s*,\s*([-\d.]+)/);
        const cm = tags.match(/\\1?c(&H[0-9a-f]+&?)/i);
        const fs = tags.match(/\\fs([\d.]+)/);
        const bm = tags.match(/\\b(\d)/);
        const im = tags.match(/\\i(\d)/);
        body = body.replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n').replace(/\\n/g, '\n').replace(/\\h/g, ' ').trim();
        if (!body) continue;
        const size = (fs ? +fs[1] : +(st.fontsize || 20)) / playResY;
        const mv = +(ev.marginv || 0) || +(st.marginv || 10);
        cues.push({
          s: tsToSec(ev.start), e: tsToSec(ev.end), text: body, an,
          pos: pm ? [+pm[1] / playResX, +pm[2] / playResY] : null,
          marginV: mv / playResY,
          color: assColor(cm ? cm[1] : st.primarycolour) || '#ffffff',
          outline: assColor(st.outlinecolour) || '#000000',
          size: Math.min(0.2, Math.max(0.02, size)),
          bold: bm ? bm[1] !== '0' : st.bold === '-1' || st.bold === '1',
          italic: im ? im[1] !== '0' : st.italic === '-1' || st.italic === '1',
          layer: +(ev.layer || 0),
          font: st.fontname || null,
        });
      }
    }
  }
  return cues.sort((a, b) => a.s - b.s);
}

function legacyAlign(a) {
  // SSA \a: 1-3 하단, 5-7 상단(+4), 9-11 중앙(+8)
  if (a >= 9) return a - 5;
  if (a >= 5) return a + 2;
  return a;
}

function parseSubtitle(buf, filename = '') {
  const text = decodeText(buf);
  const ext = (filename.split('.').pop() || '').toLowerCase();
  let cues;
  if (ext === 'smi' || ext === 'sami' || /<sami>/i.test(text.slice(0, 2000))) cues = parseSmi(text);
  else if (ext === 'ass' || ext === 'ssa' || /\[script info\]/i.test(text.slice(0, 2000))) cues = parseAss(text);
  else cues = parseSrtVtt(text);
  return cues.filter((c) => c.e > c.s && c.text);
}

const SUB_EXT = ['srt', 'vtt', 'smi', 'sami', 'ass', 'ssa'];

module.exports = { parseSubtitle, decodeText, SUB_EXT };
