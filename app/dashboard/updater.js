// 자동 업데이트 (GitHub Releases의 latest.yml 기준)
// - 시작할 때와 6시간마다 확인 → 새 버전이 있으면 백그라운드로 내려받음
// - 서버가 열려 있는 동안에는 강제로 재시작하지 않음. 프로그램을 닫을 때 설치되거나, 사용자가 "지금 업데이트"를 누르면 설치
const { app } = require('electron');

function createUpdater({ send, isServerRunning, getEnabled, log }) {
  const state = { status: app.isPackaged ? 'idle' : 'dev', version: app.getVersion(), latest: null, progress: 0, error: null, notes: '' };
  const emit = (patch) => { Object.assign(state, patch); send('update', { ...state }); };
  if (!app.isPackaged) return { state, check: async () => emit({ status: 'dev' }), install: () => {}, setEnabled: () => {} };

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
  autoUpdater.on('download-progress', (p) => emit({ status: 'downloading', progress: p.percent / 100 }));
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

  return {
    state,
    check,
    setEnabled: () => schedule(),
    // 지금 재시작하고 설치 (조용히 설치 후 자동 실행)
    install: () => {
      if (state.status !== 'ready') return false;
      app.isQuitting = true;
      setImmediate(() => autoUpdater.quitAndInstall(true, true));
      return true;
    },
    isServerRunning,
  };
}

function notesText(n) {
  if (!n) return '';
  if (Array.isArray(n)) n = n.map((x) => x.note || '').join('\n');
  return String(n).replace(/<[^>]+>/g, '').trim().slice(0, 1500);
}

module.exports = { createUpdater };
