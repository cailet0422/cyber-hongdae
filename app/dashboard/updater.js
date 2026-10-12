// 자동 업데이트 (GitHub Releases의 latest.yml 기준)
// - 시작할 때와 6시간마다 확인 → 새 버전이 있으면 백그라운드로 내려받음
// - 서버가 열려 있는 동안에는 강제로 재시작하지 않음. 프로그램을 닫을 때 설치되거나, 사용자가 "지금 업데이트"를 누르면 설치
// - 설치하는 동안에는 프로그램이 꺼져 있으므로 작은 설치 진행 창(update-splash)을 띄우고, 새 버전이 켜지면 "업데이트 완료"를 알림
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { showUpdateSplash } = require('./update-splash');

function createUpdater({ send, isServerRunning, getEnabled, log }) {
  const state = { status: app.isPackaged ? 'idle' : 'dev', version: app.getVersion(), latest: null, progress: 0, transferred: 0, total: 0,
    error: null, notes: '', justUpdated: null };
  const emit = (patch) => { Object.assign(state, patch); send('update', { ...state }); };
  const dismissNotice = () => emit({ justUpdated: null });
  if (!app.isPackaged) return { state, check: async () => emit({ status: 'dev' }), install: () => {}, setEnabled: () => {}, prepareQuitInstall: () => false, dismissNotice };

  // 방금 업데이트되어 켜졌는지: 지난번 실행 버전과 비교 (설치 프로그램이 다시 실행할 때는 --updated 인자도 붙음)
  const flagFile = path.join(app.getPath('userData'), 'update-done.flag');
  const markerFile = path.join(app.getPath('userData'), 'last-version');
  let prev = null;
  try { prev = fs.readFileSync(markerFile, 'utf8').trim() || null; } catch {}
  if ((prev && prev !== state.version) || (!prev && process.argv.includes('--updated'))) {
    state.justUpdated = { from: prev, to: state.version };
    try { fs.writeFileSync(flagFile, state.version); } catch {}   // 설치 진행 창에 "새 버전이 켜졌다"고 알림
  }
  try { fs.writeFileSync(markerFile, state.version); } catch {}

  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.logger = { info: (m) => log?.('[업데이트] ' + m), warn: (m) => log?.('[업데이트] ' + m), error: (m) => log?.('[업데이트 오류] ' + m), debug: () => {} };
  // 테스트용: 로컬 업데이트 서버 (CYBER_UPDATE_URL=http://127.0.0.1:8080)
  if (process.env.CYBER_UPDATE_URL) autoUpdater.setFeedURL({ provider: 'generic', url: process.env.CYBER_UPDATE_URL });

  autoUpdater.on('checking-for-update', () => emit({ status: 'checking', error: null }));
  autoUpdater.on('update-not-available', () => emit({ status: 'latest', latest: state.version }));
  autoUpdater.on('update-available', (info) => emit({ status: 'downloading', latest: info.version, progress: 0, notes: notesText(info.releaseNotes) }));
  autoUpdater.on('download-progress', (p) => emit({ status: 'downloading', progress: p.percent / 100, transferred: p.transferred, total: p.total }));
  autoUpdater.on('update-downloaded', (info) => emit({ status: 'ready', latest: info.version, progress: 1 }));
  autoUpdater.on('error', (e) => emit({ status: 'error', error: String(e?.message || e).split('\n')[0].slice(0, 200) }));

  let timer = null;
  const check = async () => {
    try { await autoUpdater.checkForUpdates(); } catch (e) { emit({ status: 'error', error: String(e?.message || e).slice(0, 200) }); }
  };
  const schedule = () => {
    clearInterval(timer);
    timer = null;
    if (!getEnabled()) return;
    timer = setInterval(check, 6 * 60 * 60 * 1000);
    setTimeout(check, 5000);
  };
  schedule();

  let splashShown = false;
  const splash = (mode) => {
    if (splashShown) return false;
    splashShown = true;
    const installer = autoUpdater.installerPath || `CyberHongdae-Setup-${state.latest}.exe`;
    return showUpdateSplash({ version: state.latest, mode, installerName: path.basename(installer, '.exe'), exePath: process.execPath, flagFile, title: '사이버 홍대입구' });
  };

  return {
    state,
    check,
    setEnabled: () => schedule(),
    dismissNotice,
    // 지금 재시작하고 설치 (조용히 설치 후 자동 실행). 안내 화면을 잠깐 보여 준 뒤 종료
    install: () => {
      if (state.status !== 'ready') return false;
      app.isQuitting = true;
      emit({ status: 'installing' });
      splash('restart');
      setTimeout(() => autoUpdater.quitAndInstall(true, true), 1500);
      return true;
    },
    // 프로그램을 닫을 때 받아 둔 업데이트가 설치되면 진행 창을 띄움. 띄웠으면 true (창이 뜰 시간을 조금 줘야 함)
    prepareQuitInstall: () => state.status === 'ready' && splash('quit'),
    isServerRunning,
  };
}

function notesText(n) {
  if (!n) return '';
  if (Array.isArray(n)) n = n.map((x) => x.note || '').join('\n');
  return String(n).replace(/<[^>]+>/g, '').trim().slice(0, 1500);
}

module.exports = { createUpdater };
