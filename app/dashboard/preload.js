const { contextBridge, ipcRenderer, webUtils } = require('electron');

const listeners = new Map();
ipcRenderer.on('evt', (_e, ch, data) => (listeners.get(ch) || []).forEach((cb) => cb(data)));

contextBridge.exposeInMainWorld('api', {
  call: (method, ...args) => ipcRenderer.invoke('call', method, args),
  on: (ch, cb) => { if (!listeners.has(ch)) listeners.set(ch, []); listeners.get(ch).push(cb); },
  // 드래그&드롭한 파일의 실제 경로
  pathOf: (file) => webUtils.getPathForFile(file),
});
