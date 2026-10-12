// 외부 도구를 공식 배포처에서 tools/bin 으로 내려받는다 (Windows)
//   ffmpeg/ffprobe (gyan.dev), yt-dlp (GitHub), cloudflared (GitHub)
// 이미 있으면 건너뛴다. --force 를 주면 다시 받는다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const BIN = path.resolve(__dirname, '..', '..', 'tools', 'bin');
const force = process.argv.includes('--force');
fs.mkdirSync(BIN, { recursive: true });

async function download(url, dest) {
  process.stdout.write(`  내려받는 중: ${url}\n`);
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status} (${url})`);
  const total = +r.headers.get('content-length') || 0;
  const out = fs.createWriteStream(dest);
  let got = 0, last = 0;
  for await (const chunk of r.body) {
    out.write(chunk);
    got += chunk.length;
    if (total && Date.now() - last > 1000) { last = Date.now(); process.stdout.write(`    ${Math.round(got / total * 100)}%\r`); }
  }
  await new Promise((res) => out.end(res));
  process.stdout.write('    완료        \n');
}

const has = (n) => fs.existsSync(path.join(BIN, n));

(async () => {
  if (process.platform !== 'win32') {
    console.log('Windows가 아닌 환경입니다. ffmpeg, yt-dlp, cloudflared를 패키지 관리자로 설치해 PATH에 두세요.');
    return;
  }
  if (force || !has('yt-dlp.exe')) {
    console.log('[yt-dlp] 유튜브·구글드라이브 등 링크 재생');
    await download('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe', path.join(BIN, 'yt-dlp.exe'));
  } else console.log('[yt-dlp] 이미 있음');

  if (force || !has('cloudflared.exe')) {
    console.log('[cloudflared] 버튼 한 번으로 인터넷 공개 주소 만들기');
    await download('https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe', path.join(BIN, 'cloudflared.exe'));
  } else console.log('[cloudflared] 이미 있음');

  if (force || !has('ffmpeg.exe') || !has('ffprobe.exe')) {
    console.log('[ffmpeg] 영상 변환·분석');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cyber-ffmpeg-'));
    const zip = path.join(tmp, 'ffmpeg.zip');
    await download('https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip', zip);
    console.log('  압축 푸는 중…');
    execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${tmp}' -Force`], { stdio: 'inherit' });
    const dir = fs.readdirSync(tmp).map((d) => path.join(tmp, d, 'bin')).find((d) => fs.existsSync(path.join(d, 'ffmpeg.exe')));
    if (!dir) throw new Error('ffmpeg 압축 파일에서 실행 파일을 찾지 못했습니다');
    for (const f of ['ffmpeg.exe', 'ffprobe.exe']) fs.copyFileSync(path.join(dir, f), path.join(BIN, f));
    fs.rmSync(tmp, { recursive: true, force: true });
  } else console.log('[ffmpeg] 이미 있음');

  console.log('도구 준비 완료:', BIN);
})().catch((e) => { console.error('도구 설치 실패:', e.message); process.exit(1); });
