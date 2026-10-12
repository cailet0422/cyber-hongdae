// 상영 제어: 서버 시계 기준으로 재생 위치를 관리하고 모든 클라이언트가 같은 장면을 보게 한다
const { EventEmitter } = require('events');

class Playback extends EventEmitter {
  constructor(media) {
    super();
    this.media = media;
    this.index = 0;
    this.itemId = null;
    this.playing = false;
    this.pos = 0;       // ref 시점의 재생 위치(초)
    this.ref = Date.now();
    this.loop = 'all';  // none | all | one
    this.autoplay = true;
    this.waiting = false; // 항목 준비 대기 중
    this.stopped = true;
    this._timer = null;
    this._plLen = media.playlist.length;
    media.on('change', () => this._onMediaChange());
    media.on('expanded', ({ from, to }) => {
      if (this.itemId === from) { this.itemId = to[0] || null; this._sync(); }
    });
  }

  position() {
    return this.playing ? this.pos + (Date.now() - this.ref) / 1000 : this.pos;
  }
  current() { return this.itemId ? this.media.get(this.itemId) : null; }

  snapshot() {
    const it = this.current();
    const info = it ? this.media.playInfo(it) : null;
    return {
      index: this.index,
      itemId: this.itemId,
      title: it?.title || '',
      item: info,
      status: this.stopped ? 'stopped' : !it ? 'stopped' : it.status !== 'ready' ? 'preparing' : this.playing ? 'playing' : 'paused',
      prepare: it && it.status !== 'ready' ? { status: it.status, progress: it.progress || 0, text: it.statusText || '', error: it.error } : null,
      playing: this.playing && !!info,
      pos: this.position(),
      serverTime: Date.now(),
      loop: this.loop,
      total: this.media.playlist.length,
    };
  }

  _emit() { this.emit('change', this.snapshot()); }

  _setItem(i, { play = true, pos = 0 } = {}) {
    const pl = this.media.playlist;
    if (!pl.length) return this.stop();
    this.index = ((i % pl.length) + pl.length) % pl.length;
    this.itemId = pl[this.index];
    this.media.setCurrentIndex(this.index);
    this.pos = pos;
    this.ref = Date.now();
    this.stopped = false;
    this.wantPlay = play;
    this._sync();
  }

  // 현재 항목 상태에 맞춰 재생/대기를 정리
  async _sync() {
    clearTimeout(this._timer);
    const it = this.current();
    if (!it) { this.playing = false; this._emit(); return; }
    if (it.status !== 'ready') {
      if (this.playing) this.pos = this.position();
      this.playing = false;
      this.waiting = true;
      this._emit();
      return;
    }
    if (it.mode === 'stream' && it.kind === 'ytdl') {
      try { await this.media.resolveStream(it); } catch (e) { it.status = 'error'; it.error = String(e.message || e); this._emit(); return this._autoSkip(); }
    }
    if (this.waiting && this.wantPlay) { this.waiting = false; this.pos = this.pos || 0; this.ref = Date.now(); this.playing = true; }
    else if (this.wantPlay && !this.playing) { this.ref = Date.now(); this.playing = true; }
    this.waiting = false;
    this._schedule();
    this._emit();
  }

  _autoSkip() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => { if (this.current()?.status === 'error') this.next(true); }, 3000);
  }

  _schedule() {
    clearTimeout(this._timer);
    const it = this.current();
    if (!this.playing || !it || it.live) return;
    const dur = it.isImage ? (it.duration || 10) : it.duration;
    if (!dur) return; // 길이를 모르면 클라이언트의 ended 보고로 넘김
    const left = Math.max(0, dur - this.position());
    this._timer = setTimeout(() => this._ended(), left * 1000 + 800);
  }

  _ended() {
    if (this.loop === 'one') return this._setItem(this.index, { play: true });
    const last = this.index >= this.media.playlist.length - 1;
    if (last && this.loop === 'none') { this.playing = false; this.pos = 0; this.stopped = true; this._emit(); return; }
    this._setItem(this.index + 1, { play: true });
  }

  _onMediaChange() {
    const pl = this.media.playlist;
    const wasEmpty = this._plLen === 0;
    this._plLen = pl.length;
    // 빈 대기열에 처음 영상을 올리면 재생 버튼을 누르지 않아도 준비되는 대로 바로 상영
    if (wasEmpty && pl.length && this.autoplay && this.stopped) return this._setItem(0, { play: true });
    if (this.itemId && !pl.includes(this.itemId)) {
      // 재생 중 항목이 삭제됨
      if (!pl.length) return this.stop();
      return this._setItem(Math.min(this.index, pl.length - 1), { play: this.playing || this.wantPlay });
    }
    if (this.itemId) this.index = pl.indexOf(this.itemId);
    const it = this.current();
    if (it && this.waiting && it.status === 'ready') return this._sync();
    if (it && it.status === 'error' && !this.stopped) this._autoSkip();
    this._emit();
  }

  // ----------------------------------------------------------- 명령
  playIndex(i) { this._setItem(i, { play: true }); }
  playId(id) { const i = this.media.playlist.indexOf(id); if (i >= 0) this._setItem(i, { play: true }); }
  play() {
    if (this.stopped || !this.itemId) return this._setItem(this.index || 0, { play: true });
    this.wantPlay = true;
    if (!this.playing) { this.ref = Date.now(); this.playing = !!this.media.playInfo(this.current()); }
    this._sync();
  }
  pause() {
    this.pos = this.position();
    this.playing = false;
    this.wantPlay = false;
    clearTimeout(this._timer);
    this._emit();
  }
  toggle() { this.playing ? this.pause() : this.play(); }
  seek(sec) {
    const it = this.current();
    const d = it?.duration || 0;
    this.pos = Math.max(0, d ? Math.min(sec, d - 0.5) : sec);
    this.ref = Date.now();
    this._schedule();
    this._emit();
  }
  next() { this._setItem(this.index + 1, { play: true }); }
  prev() {
    if (this.position() > 5) return this.seek(0);
    this._setItem(this.index - 1, { play: true });
  }
  stop() {
    clearTimeout(this._timer);
    this.playing = false; this.wantPlay = false; this.pos = 0; this.stopped = true;
    this._emit();
  }
  setLoop(m) { if (['none', 'all', 'one'].includes(m)) { this.loop = m; this._emit(); } }

  // 클라이언트가 영상 끝을 보고 (길이를 모르는 스트림용)
  reportEnded(itemId) {
    const it = this.current();
    if (!it || it.id !== itemId || !this.playing) return;
    if (it.duration && this.position() < it.duration - 3) return;
    if (!it.duration && this.position() < 5) return;
    if (it.live) return;
    this._ended();
  }
  // 클라이언트가 알아낸 길이 (원격 스트림)
  reportDuration(itemId, d) {
    const it = this.current();
    if (!it || it.id !== itemId || it.duration || !(d > 0) || !isFinite(d)) return;
    it.duration = d;
    this._schedule();
    this.media.save();
  }
}

module.exports = { Playback };
