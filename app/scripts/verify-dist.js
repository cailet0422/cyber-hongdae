// 빌드된 설치판(dist/win-unpacked)의 서버를 띄워 접속자 화면 파일을 모두 검사한다 (npm run dist 마지막 단계)
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const dir = path.resolve(__dirname, '..', '..', 'dist', 'win-unpacked');
const exe = path.join(dir, 'CyberHongdae.exe');
const port = 7799;
const p = spawn(exe, [path.join(dir, 'resources', 'app', 'server', 'standalone.js'), '--port', String(port), '--expose', 'lan'], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', CYBER_DATA_DIR: '' },
  windowsHide: true,
});
let done = false;
const finish = (code) => { if (done) return; done = true; try { p.kill(); } catch {} process.exit(code); };
setTimeout(() => {
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'verify-client.js'), `http://127.0.0.1:${port}`], { stdio: 'inherit' });
    finish(0);
  } catch { finish(1); }
}, 4000);
setTimeout(() => { console.error('검사 시간 초과'); finish(1); }, 60000);
