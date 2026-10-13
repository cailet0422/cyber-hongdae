// 서버가 접속자 화면에 필요한 파일을 모두 제공하는지 검사 (설치판 빌드 검증용)
//   node scripts/verify-client.js [http://127.0.0.1:7777]
// index.html의 import map을 읽고 main.js부터 모든 import / import()를 따라가며 요청한다.
const BASE = (process.argv[2] || 'http://127.0.0.1:7777').replace(/\/$/, '');

(async () => {
  const html = await (await fetch(BASE + '/')).text();
  const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
  const resolve = (spec, from) => {
    if (/^https?:/.test(spec)) return spec;
    if (spec.startsWith('/') || spec.startsWith('.')) return new URL(spec, from).href;
    if (map[spec]) return BASE + map[spec];
    const pre = Object.keys(map).filter((k) => k.endsWith('/') && spec.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    if (pre) return BASE + map[pre] + spec.slice(pre.length);
    throw new Error('해석할 수 없는 모듈: ' + spec + ' (' + from + ')');
  };
  const seen = new Set();
  const failed = [];
  const queue = [BASE + '/js/main.js', ...Object.values(map).filter((v) => !v.endsWith('/')).map((v) => BASE + v)];
  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const r = await fetch(url);
    if (!r.ok) { failed.push(`${r.status} ${url}`); continue; }
    const src = await r.text();
    const specs = [...src.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1] || m[2] || m[3]);
    for (const s of specs) {
      try { queue.push(resolve(s, url)); } catch (e) { failed.push(e.message); }
    }
  }
  // 정적 에셋
  for (const p of ['/css/style.css', '/assets/map/cinema.glb', '/assets/blade/sheet.png', '/assets/textures/sign4_bg.jpg', '/assets/textures/led_idle2.jpg', '/assets/posters/poster_1.jpg', '/vendor/hls/hls.mjs', '/api/info']) {
    const r = await fetch(BASE + p);
    if (!r.ok) failed.push(`${r.status} ${BASE + p}`);
  }
  console.log(`모듈 ${seen.size}개 확인`);
  if (failed.length) { console.log('❌ 실패:\n' + failed.join('\n')); process.exit(1); }
  console.log('✅ 접속자 화면에 필요한 파일이 모두 정상입니다');
})().catch((e) => { console.error('검사 실패:', e.message); process.exit(1); });
