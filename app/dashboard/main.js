// 사이버 홍대입구 관리자 대시보드 (Electron 메인 프로세스)
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Menu } = require('electron');
const QRCode = require('qrcode');
const { CinemaServer } = require('../server');
const { SUB_EXT, VIDEO_EXT, IMAGE_EXT } = require('../server/media');
const { makeAdminApi, ADMIN_EVENTS } = require('../server/admin-api');
const { createUpdater } = require('./updater');

// 설치판: 설치 폴더는 쓰기 권한이 없을 수 있으므로 사용자 폴더(%APPDATA%)에 저장
const DATA_DIR = process.env.CYBER_DATA_DIR || (app.isPackaged ? path.join(app.getPath('userData'), 'data') : path.resolve(__dirname, '..', 'data'));
let win = null;
let server = null;
let updater = null;

function send(ch, data) { if (win && !win.isDestroyed()) win.webContents.send('evt', ch, data); }

function createServer() {
  server = new CinemaServer({ dataDir: DATA_DIR });
  for (const ev of ADMIN_EVENTS) server.on(ev, (d) => send(ev, d));
  server.on('log', (l) => console.log(l));
  updater = createUpdater({
    send,
    isServerRunning: () => server.running,
    getEnabled: () => server.config.autoUpdate !== false,
    log: (m) => server.log(m),
  });
  buildApi();
}

const pickers = {
  async pickFiles(kind) {
    const filters = kind === 'sub' ? [{ name: '자막', extensions: SUB_EXT }]
      : kind === 'image' ? [{ name: '이미지', extensions: IMAGE_EXT }]
      : kind === 'lobby' ? [{ name: '영상/이미지', extensions: [...VIDEO_EXT, ...IMAGE_EXT] }]
      : [{ name: '영상·자막', extensions: [...VIDEO_EXT, ...SUB_EXT, ...IMAGE_EXT] }, { name: '모든 파일', extensions: ['*'] }];
    const r = await dialog.showOpenDialog(win, { properties: kind === 'sub' || kind === 'image' ? ['openFile'] : ['openFile', 'multiSelections'], filters });
    return r.canceled ? [] : r.filePaths;
  },
  async pickFolder() {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  },
};

let API = null;
function buildApi() {
  API = makeAdminApi(server, {
    ...pickers,
    openExternal: (url) => /^https?:\/\//.test(url) && shell.openExternal(url),
    openDataDir: () => shell.openPath(DATA_DIR),
    copy: (text) => clipboard.writeText(String(text)),
    qr: (text) => QRCode.toDataURL(String(text), { margin: 1, width: 360, color: { dark: '#111111', light: '#ffffff' } }),
    // 자동 업데이트
    updateState: () => ({ ...updater.state, enabled: server.config.autoUpdate !== false }),
    checkUpdate: () => updater.check(),
    setAutoUpdate: (on) => { server.setConfig({ autoUpdate: !!on }); updater.setEnabled(); return !!on; },
    installUpdate: async () => {
      if (updater.state.status !== 'ready') return false;
      if (server.running) {
        const r = await dialog.showMessageBox(win, {
          type: 'question', buttons: ['서버 닫고 업데이트', '나중에'], defaultId: 0, cancelId: 1,
          title: '업데이트', message: `새 버전(${updater.state.latest})을 설치하려면 프로그램을 다시 시작해야 합니다.\n서버가 열려 있어 접속자 모두의 연결이 끊어집니다.`,
        });
        if (r.response !== 0) return false;
        await server.stop();
      }
      return updater.install();
    },
  });
}

ipcMain.handle('call', async (_e, method, args) => {
  const fn = API[method];
  if (!fn) throw new Error('알 수 없는 기능: ' + method);
  return fn(...(args || []));
});

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 980, minHeight: 640,
    title: '사이버 홍대입구 관리자',
    backgroundColor: '#101016',
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('console-message', (ev) => { if (ev.level === 'error' || ev.level === 'warning') console.error('[renderer]', ev.message); });
  win.on('close', async (e) => {
    if (server?.running && !app.isQuitting) {
      e.preventDefault();
      const r = await dialog.showMessageBox(win, {
        type: 'question', buttons: ['서버 닫고 종료', '취소'], defaultId: 1, cancelId: 1,
        title: '종료 확인', message: '서버가 열려 있습니다. 종료하면 접속자 모두의 연결이 끊어집니다.',
      });
      if (r.response === 0) { app.isQuitting = true; await server.stop(); win.close(); }
    }
  });
  if (process.argv.includes('--devtools')) win.webContents.openDevTools({ mode: 'detach' });
  // 문서용 스크린샷: --screenshot=경로.png [--tab=media]
  const shot = process.argv.find((a) => a.startsWith('--screenshot='));
  if (shot) {
    const tab = (process.argv.find((a) => a.startsWith('--tab=')) || '--tab=home').slice(6);
    win.webContents.once('did-finish-load', async () => {
      await win.webContents.executeJavaScript(`document.querySelector('nav button[data-tab="${tab}"]')?.click()`);
      setTimeout(async () => {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(shot.slice(13), img.toPNG());
        app.isQuitting = true;
        app.quit();
      }, 2500);
    });
  }
}

app.whenReady().then(() => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  createServer();
  createWindow();
  if (process.argv.includes('--autostart')) server.start().catch(() => {});
});
app.on('window-all-closed', async () => { if (server?.running) await server.stop(); app.quit(); });

// 예상치 못한 오류로 서버 전체가 꺼지지 않도록 기록만 남긴다
process.on('uncaughtException', (e) => server?.log('예상치 못한 오류: ' + (e?.stack || e)));
process.on('unhandledRejection', (e) => server?.log('처리되지 않은 오류: ' + (e?.stack || e)));
