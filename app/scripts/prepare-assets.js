// 원본 케이온 모델/포즈/응원봉 도안을 웹 클라이언트용 ASCII 경로로 복사
const fs = require('fs');
const { execFileSync } = require('child_process');
const { TOOLS } = require('../server/tools');
const path = require('path');

// 사용법: node scripts/prepare-assets.js [모델 팩 폴더]
// 모델 팩(MMD PMD)은 라이선스상 저장소에 포함하지 않는다. 직접 받은 팩을 저장소 루트에 두면 자동으로 찾아 변환하고,
// 없으면 아무것도 하지 않는다(접속자 화면은 저장소에 포함된 오리지널 아바타를 사용).
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(__dirname, '..', 'client', 'assets');
const SRC = [
  process.argv[2],
  path.join(ROOT, 'kakomiki k-on models', 'kakomiki k-on models'),
  path.join(ROOT, 'kakomiki k-on models'),
  path.join(ROOT, 'models'),
].filter(Boolean).find((d) => fs.existsSync(path.join(d, 'Yui Hirasawa')) || fs.existsSync(path.join(d, 'Mio Akiyama')));

const CHARS = [
  { id: 'yui', dir: 'Yui Hirasawa', pmd: '平沢唯.pmd' },
  { id: 'mio', dir: 'Mio Akiyama', pmd: '秋山澪.pmd' },
  { id: 'ritsu', dir: 'Ritsu Tainaka', pmd: '田井中律.pmd' },
  { id: 'mugi', dir: 'Kotobuki Tsumugi', pmd: '琴吹紬.pmd' },
  { id: 'azusa', dir: 'Azusa Nakano', pmd: '中野梓.pmd' },
];

function copy(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

// 구버전 PMD는 물리(강체) 섹션이 없어 three.js 파서가 실패하므로 빈 섹션(강체 0, 조인트 0)을 덧붙인다
async function ensureParsable(file) {
  const { MMDParser } = await import('three/examples/jsm/libs/mmdparser.module.js');
  const parser = new MMDParser.Parser();
  const tryParse = () => {
    const b = fs.readFileSync(file);
    parser.parsePmd(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), true);
  };
  try { tryParse(); return; } catch {}
  fs.appendFileSync(file, Buffer.alloc(8));
  tryParse();
  console.log('  patched empty physics section:', path.basename(path.dirname(file)));
}

(async () => {
if (!SRC) {
  console.log('기본(오리지널) 아바타를 사용합니다. 접속자는 입장 화면에서 자기 3D 모델을 올릴 수 있습니다.');
} else for (const c of CHARS) {
  const dir = path.join(SRC, c.dir);
  if (!fs.existsSync(path.join(dir, c.pmd))) { console.log('건너뜀:', c.id); continue; }
  const out = path.join(OUT, 'models', c.id);
  copy(path.join(dir, c.pmd), path.join(out, 'model.pmd'));
  for (const f of fs.readdirSync(dir)) {
    if (/\.(bmp|png|jpg|sph|spa)$/i.test(f)) copy(path.join(dir, f), path.join(out, f));
    // TGA(무압축)는 WebP로 변환해 전송량을 줄인다. 클라이언트가 .tga 요청을 .webp로 바꿔 받음
    if (/\.tga$/i.test(f)) {
      const dst = path.join(out, f.replace(/\.tga$/i, '.webp'));
      fs.mkdirSync(out, { recursive: true });
      execFileSync(TOOLS.ffmpeg, ['-v', 'error', '-y', '-i', path.join(dir, f), '-c:v', 'libwebp', '-quality', '92', dst]);
    }
  }
  await ensureParsable(path.join(out, 'model.pmd'));
  const vpd = path.join(SRC, 'character poses', `${c.dir}.vpd`);
  if (fs.existsSync(vpd)) copy(vpd, path.join(OUT, 'poses', `${c.id}.vpd`));
  console.log('copied', c.id);
}
const blade = path.join(ROOT, 'BLADE', '1791809306.png');
if (fs.existsSync(blade)) copy(blade, path.join(OUT, 'blade', 'sheet.png'));
console.log('done');
})();
