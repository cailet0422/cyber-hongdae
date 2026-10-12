// 관리자 기능 목록 (Electron 대시보드 IPC와 로컬 웹 대시보드 RPC가 공용으로 사용)
function makeAdminApi(server, extra = {}) {
  const m = server.media;
  const pb = server.playback;
  return {
    state: () => ({
      status: server.status,
      urls: server.running ? server.urls() : null,
      config: server.config,
      playback: pb.snapshot(),
      media: server.mediaState(),
      users: server.userList(),
      chat: server.chatLog.slice(-200),
      bans: server.bans,
      logs: server.logs.slice(-200),
      dataDir: server.dataDir,
    }),
    start: async (opts) => { await server.start(opts); return makeAdminApi(server).state(); },
    stop: async () => { await server.stop(); return makeAdminApi(server).state(); },
    // 재생목록
    addFiles: (paths, opts) => m.addFiles(paths, opts),
    addFolder: (dir, opts) => m.addFolder(dir, opts),
    addUrls: (text, opts) => m.addUrls(text, opts),
    remove: (id) => m.remove(id),
    move: (id, i) => m.move(id, i),
    rename: (id, t) => m.rename(id, t),
    retry: (id) => m.retry(id),
    setMode: (id, mode) => m.setMode(id, mode),
    clearPlaylist: () => m.clear(),
    attachSub: (id, file) => m.attachSubtitleFile(id, file),
    attachSubUrl: (id, url) => m.attachSubtitleUrl(id, url),
    selectSub: (id, sid) => m.selectSub(id, sid),
    removeSub: (id, sid) => m.removeSub(id, sid),
    clearCache: () => m.clearCache(),
    // 재생
    play: (i) => (i == null ? pb.play() : pb.playIndex(i)),
    playId: (id) => pb.playId(id),
    pause: () => pb.pause(),
    toggle: () => pb.toggle(),
    seek: (s) => pb.seek(s),
    next: () => pb.next(),
    prev: () => pb.prev(),
    stopPlayback: () => pb.stop(),
    setLoop: (mode) => pb.setLoop(mode),
    // 전광판 / 설정
    setLobby: (id) => server.setLobbyItem(id),
    setConfig: (patch) => server.setConfig(patch),
    // 접속자 / 채팅
    kick: (id, r) => server.kick(id, r),
    ban: (id, r) => server.ban(id, r),
    unban: (id) => server.unban(id),
    mute: (id, on) => server.mute(id, on),
    notice: (t) => server.notice(t),
    clearChat: () => server.clearChat(),
    ...extra,
  };
}

const ADMIN_EVENTS = ['status', 'log', 'users', 'chat', 'chatclear', 'playback', 'media', 'item', 'config', 'bans'];

module.exports = { makeAdminApi, ADMIN_EVENTS };
