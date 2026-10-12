// Electron 실행 파일이 없으면 (npm 설치 스크립트가 막혔거나 압축 해제가 실패한 경우) 직접 내려받아 푼다
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const pkgDir = path.dirname(require.resolve('electron/package.json'));
const version = require('electron/package.json').version;
const dist = path.join(pkgDir, 'dist');
const exe = path.join(dist, process.platform === 'win32' ? 'electron.exe' : 'electron');

(async () => {
  if (fs.existsSync(exe)) { console.log('Electron OK:', version); return; }
  const name = `electron-v${version}-${process.platform}-${process.arch}.zip`;
  // electron 공식 캐시 폴더에서 먼저 찾기
  const cacheRoot = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.cache'), 'electron', 'Cache');
  let zip = null;
  if (fs.existsSync(cacheRoot)) {
    for (const d of fs.readdirSync(cacheRoot)) {
      const p = path.join(cacheRoot, d, name);
      if (fs.existsSync(p)) zip = p;
    }
  }
  if (!zip) {
    zip = path.join(os.tmpdir(), name);
    const url = `https://github.com/electron/electron/releases/download/v${version}/${name}`;
    console.log('Electron 내려받는 중:', url);
    const r = await fetch(url);
    if (!r.ok) throw new Error('다운로드 실패 HTTP ' + r.status);
    fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
  }
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  if (process.platform === 'win32') {
    execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dist}' -Force`], { stdio: 'inherit' });
  } else {
    execFileSync('unzip', ['-q', '-o', zip, '-d', dist], { stdio: 'inherit' });
  }
  fs.writeFileSync(path.join(pkgDir, 'path.txt'), process.platform === 'win32' ? 'electron.exe' : 'electron');
  console.log('Electron 설치 완료:', version);
})().catch((e) => { console.error('Electron 설치 실패:', e.message); process.exit(1); });
