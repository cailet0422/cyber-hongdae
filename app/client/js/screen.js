// 상영관 스크린 / 로비 전광판 / 4관 입구 전광판
import * as THREE from 'three';

const SCREEN_IDLE_BG = '#07070b';
const DEFAULT_POSTERS = Array.from({ length: 8 }, (_, i) => `/assets/posters/poster_${i + 1}.jpg`);

// 디스플레이 메시 위에 덮는 평면 (법선 방향 기준)
function overlayPlane(display, w, h, mat, lift = 0.012) {
  const geo = display.mesh.geometry;
  geo.computeBoundingBox();
  const c = geo.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(display.mesh.matrixWorld);
  const n = new THREE.Vector3().fromBufferAttribute(geo.attributes.normal, 0).transformDirection(display.mesh.matrixWorld);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  if (n.z < -0.99) m.rotation.y = Math.PI;
  else m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  m.position.copy(c).addScaledVector(n, lift);
  m.userData.normal = n;
  m.userData.center = c;
  return m;
}

function canvasTex(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { c, g: c.getContext('2d'), t };
}

function loadImg(src, timeout = 0) {
  return new Promise((res) => {
    const i = new Image();
    i.onload = () => res(i); i.onerror = () => res(null); i.src = src;
    if (timeout) setTimeout(() => res(null), timeout);
  });
}

let HlsMod = null;
async function getHls() {
  if (!HlsMod) HlsMod = (await import('/vendor/hls/hls.mjs')).default;
  return HlsMod;
}

// 긴 영상은 지나간 구간을 메모리에서 비우고, 너무 멀리 앞서 받지 않는다. 시작 위치는 재생목록을 읽은 뒤 startLoad로 정한다.
// 원본 바로 재생(conv)은 서버가 조각을 만드는 동안 응답이 몇 초 늦을 수 있으므로 기다리는 시간을 넉넉히, 앞서 받는 양은 적게
function hlsConfig(item) {
  const c = { enableWorker: true, autoStartLoad: false, liveSyncDurationCount: 3, maxBufferLength: 30, maxMaxBufferLength: 90, backBufferLength: 30 };
  if (!item.conv) return c;
  const policy = (ttfb, load, retries) => ({ default: {
    maxTimeToFirstByteMs: ttfb, maxLoadTimeMs: load,
    timeoutRetry: { maxNumRetry: 2, retryDelayMs: 0, maxRetryDelayMs: 0 },
    errorRetry: { maxNumRetry: retries, retryDelayMs: 1000, maxRetryDelayMs: 4000 },
  } });
  return {
    ...c, maxBufferLength: 20, maxMaxBufferLength: 30, maxBufferHole: 0.5, stretchShortVideoTrack: true, nudgeMaxRetry: 6,
    manifestLoadPolicy: policy(Infinity, 60000, 3), playlistLoadPolicy: policy(30000, 60000, 3), fragLoadPolicy: policy(30000, 60000, 8),
  };
}

export class Cinema {
  constructor({ world, scene, net, prefs, audio }) {
    this.world = world;
    this.scene = scene;
    this.net = net;
    this.prefs = prefs;
    this.audio = audio; // AudioContext (입장 클릭 후 생성)
    this.snap = null;
    this.itemId = null;
    this.cues = [];
    this.subKey = '';
    this.cfg = null;
    this.brightness = 0;
    this.screenColor = new THREE.Color(0, 0, 0);
    this._syncT = 0;
    this._signT = 0;
    this._lobbyT = 0;
    this._sampleT = 0;

    this._setupScreen();
    this._setupLobby();
    this._setupSign();
  }

  // ---------------------------------------------------------------- 4관 스크린
  _setupScreen() {
    const d = this.world.displays.screen4;
    this.scrW = d.w; this.scrH = d.h;
    d.mesh.material = new THREE.MeshBasicMaterial({ color: 0x050506 });
    this.idle = canvasTex(1600, Math.round(1600 * d.h / d.w));
    this.videoMat = new THREE.MeshBasicMaterial({ map: this.idle.t, toneMapped: false });
    this.videoPlane = overlayPlane(d, d.w, d.h, this.videoMat, 0.01);
    this.scene.add(this.videoPlane);
    this.sub = canvasTex(2048, Math.round(2048 * d.h / d.w));
    this.subPlane = overlayPlane(d, d.w, d.h, new THREE.MeshBasicMaterial({ map: this.sub.t, transparent: true, toneMapped: false, depthWrite: false }), 0.03);
    this.scene.add(this.subPlane);

    this.video = this._makeVideo();
    this.video.addEventListener('ended', () => this.itemId && this.net.send({ t: 'ended', itemId: this.itemId }));
    this.video.addEventListener('loadedmetadata', () => {
      this._fit();
      if (this.snap?.item && !this.snap.item.duration && isFinite(this.video.duration)) this.net.send({ t: 'duration', itemId: this.itemId, d: this.video.duration });
    });
    this.video.addEventListener('error', () => { this.videoError = this.video.error?.message || '재생 오류'; this._drawIdle(); });
    this.vtex = new THREE.VideoTexture(this.video);
    this.vtex.colorSpace = THREE.SRGBColorSpace;

    // 스크린 반사광
    const c = this.videoPlane.userData.center.clone().addScaledVector(this.videoPlane.userData.normal, 5);
    this.screenLight = new THREE.PointLight(0xffffff, 0, 26, 1.2);
    this.screenLight.position.copy(c);
    this.scene.add(this.screenLight);
    this.sampler = document.createElement('canvas');
    this.sampler.width = 8; this.sampler.height = 4;
    this.samplerG = this.sampler.getContext('2d', { willReadFrequently: true });
    this._drawIdle();
  }

  _makeVideo() {
    const v = document.createElement('video');
    v.playsInline = true;
    v.crossOrigin = 'anonymous';
    v.preload = 'auto';
    v.setAttribute('webkit-playsinline', '');
    return v;
  }

  // 오디오 그래프: 상영관 밖에서는 저역통과 필터로 먹먹하게
  attachAudio(ctx) {
    this.audio = ctx;
    const mk = (el) => {
      const src = ctx.createMediaElementSource(el);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 20000;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(ctx.destination);
      return { filter, gain };
    };
    this.mainAudio = mk(this.video);
    this.lobbyAudio = mk(this.lobbyVideo);
  }

  _fit() {
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    let a = vw && vh ? vw / vh : 16 / 9;
    if (this.imageMode && this.imageAspect) a = this.imageAspect;
    const sa = this.scrW / this.scrH;
    const sx = a > sa ? 1 : a / sa;
    const sy = a > sa ? sa / a : 1;
    this.videoPlane.scale.set(sx, sy, 1);
    this._fitScale = [sx, sy];
  }

  _drawIdle() {
    const { c, g, t } = this.idle;
    const W = c.width, H = c.height;
    g.fillStyle = SCREEN_IDLE_BG;
    g.fillRect(0, 0, W, H);
    const grd = g.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W * 0.6);
    grd.addColorStop(0, 'rgba(60,40,90,0.55)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#e3192a';
    g.font = 'bold 64px Arial, sans-serif';
    g.fillText('EOTTE CINEMA', W / 2, H * 0.32);
    g.fillStyle = '#fff';
    g.font = 'bold 84px "Malgun Gothic", sans-serif';
    g.fillText('폭음시네마', W / 2, H * 0.5);
    const s = this.snap;
    let msg = '상영을 기다리고 있습니다';
    if (s?.prepare) {
      const p = s.prepare;
      msg = p.status === 'error' ? `재생 실패: ${p.error || ''}`.slice(0, 60) : `${s.title ? '「' + s.title.slice(0, 30) + '」 ' : ''}${p.text || '준비 중'} ${Math.round((p.progress || 0) * 100)}%`;
    } else if (this.videoError) msg = '재생할 수 없는 영상입니다';
    else if (s?.status === 'paused') msg = '일시정지';
    else if (s?.status === 'playing') msg = '불러오는 중…';
    g.font = '44px "Malgun Gothic", sans-serif';
    g.fillStyle = '#c9c9d6';
    g.fillText(msg, W / 2, H * 0.7);
    t.needsUpdate = true;
  }

  // 서버 재생 상태 반영
  async applyPlayback(snap) {
    this.snap = snap;
    this.snapLocal = performance.now();
    const item = snap.item;
    if (!item) {
      if (this.itemId) this._unload();
      this._drawIdle();
      this._loadSubs(null);
      return;
    }
    if (item.id !== this.itemId || item.url !== this.itemUrl) {
      await this._load(item);
      if (this.snap !== snap) return;   // 불러오는 동안 더 새 상태가 왔으면 그쪽이 자막까지 정리
    }
    this._loadSubs(item.sub);
    this._syncT = 0;
  }
  syncTick(m) {
    if (!this.snap || m.itemId !== this.snap.itemId) return;
    this.snap.pos = m.pos;
    this.snap.serverTime = m.serverTime;
  }

  _unload() {
    this._loadSeq = (this._loadSeq || 0) + 1;   // 아직 기다리는 _load를 무효로
    this.hls?.destroy(); this.hls = null;
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.itemId = null; this.itemUrl = null;
    this.imageMode = false;
    this.videoMat.map = this.idle.t;
    this.videoMat.needsUpdate = true;
    this.videoPlane.scale.set(1, 1, 1);
  }

  async _load(item) {
    this._unload();
    const seq = this._loadSeq;
    this.itemId = item.id;
    this.itemUrl = item.url;
    this.videoError = null;
    if (item.type === 'image') {
      const img = await loadImg(item.url);
      if (!img || this._loadSeq !== seq) return;
      const t = new THREE.Texture(img); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
      this.imageMode = true; this.imageAspect = img.width / img.height;
      this.videoMat.map = t; this.videoMat.needsUpdate = true; this._fit();
      return;
    }
    // 늦게 들어왔거나 긴 영상의 중간이면 처음부터 받지 않고 지금 상영 위치부터 불러온다
    const startAt = () => (item.live ? -1 : Math.max(0, this.targetTime()));
    const frag = () => (startAt() > 1 ? `#t=${startAt().toFixed(2)}` : '');
    if (item.type === 'hls') {
      const Hls = await getHls();
      if (this._loadSeq !== seq) return;
      if (Hls.isSupported()) {
        const hls = (this.hls = new Hls(hlsConfig(item)));
        this.hlsFails = 0;
        hls.on(Hls.Events.MANIFEST_PARSED, () => this.hls === hls && hls.startLoad(startAt()));
        hls.on(Hls.Events.FRAG_BUFFERED, () => (this.hlsFails = 0));
        hls.on(Hls.Events.ERROR, (_, d) => this._hlsError(Hls, hls, d));
        hls.loadSource(item.url);
        hls.attachMedia(this.video);
      } else this.video.src = item.url + frag();
    } else {
      this.video.src = item.url + frag();
    }
    this._drawIdle();
    this.videoMat.map = this.idle.t;
    const onPlaying = () => {
      if (this.itemId !== item.id) return;
      this.videoMat.map = this.vtex;
      this.videoMat.needsUpdate = true;
      this._fit();
    };
    this.video.addEventListener('playing', onPlaying, { once: true });
  }

  // 치명적 오류도 몇 번은 되살려 본다 (원본 바로 재생은 서버가 위치를 옮기는 동안 잠깐 실패할 수 있음)
  _hlsError(Hls, hls, d) {
    if (!d.fatal || this.hls !== hls) return;
    if (++this.hlsFails > 5 || ![Hls.ErrorTypes.MEDIA_ERROR, Hls.ErrorTypes.NETWORK_ERROR].includes(d.type)) {
      this.videoError = d.details;
      this._drawIdle();
      return;
    }
    const at = () => (this.snap?.item?.live ? -1 : Math.max(0, this.targetTime()));
    if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
      if (!hls.levels?.length) { this.videoError = d.details; this._drawIdle(); return; }   // 코덱을 못 트는 등 다시 해도 소용없음
      hls.recoverMediaError();
      hls.startLoad(at());   // autoStartLoad를 껐으므로 recoverMediaError가 0초일 때는 다시 받지 않음
      return;
    }
    // 재생목록을 아직 못 읽었으면 startLoad로는 아무것도 요청하지 않으므로 다시 불러온다
    setTimeout(() => { if (this.hls === hls) hls.levels?.length ? hls.startLoad(at()) : hls.loadSource(hls.url); }, 2000);
  }

  // 위치 맞추기. hls.js는 뒤로 찾아갈 때 받던 조각을 끝까지 기다리므로(원본 바로 재생은 몇 초 걸릴 수 있음) 받기를 새로 시작한다
  _seek(t) {
    const v = this.video;
    t = Math.max(0, t);
    this._seekTo = t;
    if (this.hls && t < v.currentTime - 1) { this.hls.stopLoad(); v.currentTime = t; this.hls.startLoad(t); }
    else v.currentTime = t;
    v.playbackRate = 1;
  }

  async _loadSubs(url) {
    if (url === this.subUrl) return;
    this.subUrl = url;
    this.cues = [];
    this._drawSubs([]);
    if (!url) return;
    try {
      const r = await fetch(url);
      const cues = await r.json();
      if (this.subUrl === url) this.cues = cues;
    } catch {}
  }

  targetTime() {
    const s = this.snap;
    if (!s) return 0;
    return s.playing ? s.pos + (this.net.now() - s.serverTime) / 1000 : s.pos;
  }

  // ---------------------------------------------------------------- 매 프레임
  update(dt, { listener, inTheater, theaterDist, lobbyDist }) {
    const s = this.snap;
    const v = this.video;
    // 동기화
    this._syncT -= dt;
    if (s && s.item && !this.imageMode && this._syncT <= 0) {
      this._syncT = 0.5;
      const target = this.targetTime();
      // 아직 아무것도 받지 못했는데 상영 위치가 크게 바뀌었으면(관리자가 찾아감) hls.js 시작 위치도 옮긴다
      // (readyState 0에서는 아래 위치 맞추기가 동작하지 않고, hls.js는 처음 정한 위치의 조각만 계속 다시 요청함)
      const h = this.hls;
      if (h && !s.item.live && v.readyState < 1 && h.levels?.length && Math.abs(h.startPosition - target) > 8) h.startLoad(target);
      if (s.playing) {
        if (v.paused && v.readyState >= 1) v.play().catch(() => this.onAutoplayBlocked?.());
        if (!s.item.live && v.readyState >= 1) {
          const drift = v.currentTime - target;
          // 찾아가는 중(조각을 기다리는 중)에는 또 찾아가지 않는다. 너무 벌어졌을 때만 다시
          if (Math.abs(drift) > 1.5) { if (!v.seeking || Math.abs(drift) > 10) this._seek(target + 0.15); }
          else if (Math.abs(drift) > 0.12) v.playbackRate = 1 - Math.max(-0.5, Math.min(0.5, drift)) * 0.2;
          else v.playbackRate = 1;
        }
      } else {
        if (!v.paused) v.pause();
        // 멈춰 있는 동안 찾아가던 위치가 다시 바뀌었으면(관리자가 또 찾아감) 새 위치로
        if (v.readyState >= 1 && Math.abs(v.currentTime - target) > 0.25 && (!v.seeking || Math.abs(target - (this._seekTo ?? target)) > 0.25)) this._seek(target);
      }
    }
    if (s && !s.item && s.prepare) {
      this._prepT = (this._prepT || 0) - dt;
      if (this._prepT <= 0) { this._prepT = 1; this._drawIdle(); }
    }

    // 자막
    const showSubs = this.prefs.showSubs && this.cues.length && this.videoMat.map === this.vtex;
    const t = v.currentTime;
    const active = showSubs ? this.cues.filter((c) => t >= c.s && t < c.e) : [];
    const key = active.map((c) => c.s + c.text).join('|') + this.prefs.subSize + (this._fitScale || '');
    if (key !== this.subKey) { this.subKey = key; this._drawSubs(active); }

    // 오디오 믹스
    if (this.mainAudio && this.audio) {
      const now = this.audio.currentTime;
      const vol = this.prefs.volume;
      let gain, freq;
      if (inTheater) { gain = vol; freq = 20000; }
      else { gain = vol * Math.max(0.03, 0.4 - theaterDist * 0.025); freq = 600; }
      this.mainAudio.gain.gain.setTargetAtTime(gain, now, 0.25);
      this.mainAudio.filter.frequency.setTargetAtTime(freq, now, 0.25);
      const lv = this.prefs.lobbyVolume * (this.cfg?.lobby?.volume ?? 0.3) * 2;
      const lg = inTheater ? 0 : lv * Math.max(0, 1 - lobbyDist / 22);
      this.lobbyAudio.gain.gain.setTargetAtTime(lg, now, 0.3);
    }

    // 스크린 반사광 / 영사기 빛 / 객석 조명
    this._sampleT -= dt;
    const playingVideo = this.videoMat.map === this.vtex && !v.paused;
    if (this._sampleT <= 0) {
      this._sampleT = 0.2;
      if (playingVideo && v.readyState >= 2) {
        try {
          this.samplerG.drawImage(v, 0, 0, 8, 4);
          const d = this.samplerG.getImageData(0, 0, 8, 4).data;
          let r = 0, g = 0, b = 0;
          for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
          const n = d.length / 4 * 255;
          this.screenColor.setRGB(r / n, g / n, b / n, THREE.SRGBColorSpace);
        } catch { this.screenColor.setRGB(0.3, 0.3, 0.3); }
      } else if (this.imageMode) this.screenColor.setRGB(0.3, 0.3, 0.3);
      else this.screenColor.setRGB(0.04, 0.03, 0.06);
    }
    const lum = this.screenColor.r * 0.3 + this.screenColor.g * 0.59 + this.screenColor.b * 0.11;
    this.brightness += (lum - this.brightness) * Math.min(1, dt * 6);
    this.screenLight.color.lerp(this.screenColor.clone().addScalar(0.05), Math.min(1, dt * 6));
    this.screenLight.intensity = inTheater ? 4 + this.brightness * 120 : 0;
    const showing = playingVideo || this.imageMode;
    this.world.theaterDim += ((showing ? 1 : 0) - this.world.theaterDim) * Math.min(1, dt * 0.8);
    if (this.world.beamMat) this.world.beamMat.uniforms.uOpacity.value = playingVideo ? 0.4 + this.brightness * 2.5 : 0;
    if (this.world.beamMat) this.world.beamMat.uniforms.uColor.value.copy(this.screenLight.color);

    this._updateSign(dt);
    this._updateLobby(dt);
  }

  _drawSubs(cues) {
    const { c, g, t } = this.sub;
    const W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    if (!cues.length) { t.needsUpdate = true; return; }
    // 실제 영상 영역(레터박스 안쪽) 기준으로 배치
    const [sx, sy] = this._fitScale || [1, 1];
    const vw = W * sx, vh = H * sy, vx = (W - vw) / 2, vy = (H - vh) / 2;
    const scale = this.prefs.subSize;
    for (const cue of cues.sort((a, b) => (a.layer || 0) - (b.layer || 0))) {
      const size = Math.max(18, (cue.size ? cue.size * vh : vh * 0.058) * scale);
      g.font = `${cue.italic ? 'italic ' : ''}${cue.bold === false && cue.size ? '' : 'bold '}${Math.round(size)}px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
      g.lineJoin = 'round';
      const lines = cue.text.split('\n');
      const an = cue.an || 2;
      const hAlign = (an - 1) % 3; // 0 왼 1 가운데 2 오른
      const vAlign = an >= 7 ? 0 : an >= 4 ? 1 : 2; // 0 위 1 중간 2 아래
      const lh = size * 1.22;
      const margin = (cue.marginV ?? 0.05) * vh;
      let x, y;
      if (cue.pos) { x = vx + cue.pos[0] * vw; y = vy + cue.pos[1] * vh; }
      else {
        x = hAlign === 0 ? vx + vw * 0.05 : hAlign === 2 ? vx + vw * 0.95 : vx + vw / 2;
        y = vAlign === 0 ? vy + margin : vAlign === 1 ? vy + vh / 2 : vy + vh - margin;
      }
      g.textAlign = hAlign === 0 ? 'left' : hAlign === 2 ? 'right' : 'center';
      const total = lh * lines.length;
      let y0 = vAlign === 0 ? y : vAlign === 1 ? y - total / 2 : y - total;
      g.textBaseline = 'top';
      lines.forEach((ln, i) => {
        const yy = y0 + i * lh;
        g.lineWidth = Math.max(4, size * 0.16);
        g.strokeStyle = cue.outline || 'rgba(0,0,0,0.92)';
        g.strokeText(ln, x, yy);
        g.fillStyle = cue.color || '#ffffff';
        g.fillText(ln, x, yy);
      });
    }
    t.needsUpdate = true;
  }

  // ---------------------------------------------------------------- 설정 (전광판)
  applyConfig(cfg) {
    const prevLobby = this.cfg?.lobby?.item?.url;
    const prevBg = this.cfg?.sign4?.bgUrl;
    this.cfg = cfg;
    if (cfg.lobby?.item?.url !== prevLobby) this._loadLobbyItem(cfg.lobby?.item);
    const posters = cfg.posters?.length ? cfg.posters : DEFAULT_POSTERS;
    if (posters.join('|') !== this._posterKey) this._loadPosters(posters);
    if (cfg.sign4?.bgUrl !== prevBg || !this.signBg) {
      loadImg(cfg.sign4?.bgUrl || '/assets/textures/sign4_bg.jpg').then((img) => { this.signBg = img; this._signT = 0; });
    }
    this._signT = 0;
    this._lobbyT = 0;
  }

  _setupSign() {
    const d = this.world.displays.sign4;
    if (!d) return;
    this.sign = canvasTex(1536, Math.round(1536 * d.h / d.w));
    d.mesh.material = new THREE.MeshBasicMaterial({ color: 0 });
    this.signPlane = overlayPlane(d, d.w, d.h, new THREE.MeshBasicMaterial({ map: this.sign.t, toneMapped: false }), 0.008);
    this.scene.add(this.signPlane);
    this.marquee = 0;
  }

  _updateSign(dt) {
    if (!this.sign) return;
    this._signT -= dt;
    if (this._signT > 0) return;
    const s = this.cfg?.sign4 || {};
    const { c, g, t } = this.sign;
    const W = c.width, H = c.height;
    if (this.signBg) g.drawImage(this.signBg, 0, 0, W, H);
    else { g.fillStyle = '#123'; g.fillRect(0, 0, W, H); }
    g.fillStyle = 'rgba(0,30,60,0.25)';
    g.fillRect(0, 0, W, H);
    const col = s.color || '#fff';
    g.shadowColor = 'rgba(0,0,0,0.7)';
    g.shadowBlur = 10;
    g.fillStyle = col;
    g.textBaseline = 'alphabetic';
    if (s.showClock !== false) {
      const now = new Date(this.net.now());
      const h = now.getHours();
      g.font = 'bold 44px Arial, sans-serif';
      g.textAlign = 'left';
      g.fillText(`${String(h % 12 || 12).padStart(2, '0')} ${String(now.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`, 26, 60);
    }
    g.font = 'bold 26px Arial, sans-serif';
    g.textAlign = 'right';
    g.fillText('EOTTE CINEMA', W - 26, 52);
    // 메인 줄: 관 / 층 / 제목
    const head = `${s.hall || '4관'}`;
    const floor = s.floor || '';
    const title = s.title || (s.nowPlaying ? '' : '상영 준비 중');
    g.textAlign = 'left';
    g.font = 'bold 70px "Malgun Gothic", sans-serif';
    g.fillText(head, 26, 200);
    const hw = g.measureText(head).width;
    g.font = 'bold 92px "Malgun Gothic", sans-serif';
    const fx = 26 + hw + 30;
    g.fillText(floor, fx, 200);
    const tx = fx + g.measureText(floor).width + 36;
    const maxW = W - tx - 20;
    g.font = 'bold 92px "Malgun Gothic", sans-serif';
    const tw = g.measureText(title).width;
    let animated = false;
    g.save();
    g.beginPath(); g.rect(tx, 90, maxW, 140); g.clip();
    if (tw > maxW) {
      animated = true;
      this.marquee = (this.marquee + 0.05 * 90) % (tw + 120);
      g.fillText(title, tx - this.marquee, 200);
      g.fillText(title, tx - this.marquee + tw + 120, 200);
    } else g.fillText(title, tx, 200);
    g.restore();
    g.font = '40px "Malgun Gothic", sans-serif';
    g.fillText(s.message || '', 26, 290);
    g.font = '30px Arial, sans-serif';
    g.fillText(s.messageEn || '', 26, 336);
    g.shadowBlur = 0;
    t.needsUpdate = true;
    this._signT = animated ? 0.05 : 1;
  }

  // ---------------------------------------------------------------- 로비 전광판
  _setupLobby() {
    const d = this.world.displays.lobby;
    if (!d) return;
    this.lobbyW = d.w; this.lobbyH = d.h;
    d.mesh.material = new THREE.MeshBasicMaterial({ color: 0 });
    this.lobbyCanvas = canvasTex(1280, Math.round(1280 * d.h / d.w));
    this.lobbyMat = new THREE.MeshBasicMaterial({ map: this.lobbyCanvas.t, toneMapped: false });
    this.lobbyPlane = overlayPlane(d, d.w, d.h, this.lobbyMat, 0.008);
    this.scene.add(this.lobbyPlane);
    this.lobbyVideo = this._makeVideo();
    this.lobbyVideo.loop = true;
    this.lobbyVtex = new THREE.VideoTexture(this.lobbyVideo);
    this.lobbyVtex.colorSpace = THREE.SRGBColorSpace;
    this.lobbyVideo.addEventListener('playing', () => { if (this.lobbyItem) { this.lobbyMat.map = this.lobbyVtex; this.lobbyMat.needsUpdate = true; } });
    this.posters = [];
    loadImg('/assets/textures/led_idle2.jpg').then((im) => (this.lobbyBg = im));
  }

  // ---------------------------------------------------------------- 포스터
  // 서버가 정한 8칸의 포스터로 맵 포스터 아틀라스(4x2)를 다시 그리고, 로비 전광판 슬라이드도 같은 포스터로 바꾼다
  async _loadPosters(urls) {
    const key = (this._posterKey = urls.join('|'));
    // 한 장이 멈춰도 나머지가 적용되도록 제한 시간을 두고, 실패한 칸은 기본 포스터로
    const imgs = await Promise.all(urls.map((u, i) => loadImg(u, 15000).then((im) => im || (u !== DEFAULT_POSTERS[i] ? loadImg(DEFAULT_POSTERS[i], 15000) : null))));
    if (key !== this._posterKey) return;
    this.posters = [...new Map(urls.map((u, i) => [u, imgs[i]])).values()].filter(Boolean);
    this._lobbyT = 0;
    this._drawPosterAtlas(imgs);
  }

  _drawPosterAtlas(imgs) {
    const mats = this.world.posterMats;
    if (!mats.length) return;
    if (!this.posterAtlas) {
      this.posterAtlas = canvasTex(2048, 1536);       // 맵(GLB)에 구운 아틀라스와 같은 배치: 4열 x 2행, 위쪽 행이 1~4번
      this.posterAtlas.t.flipY = false;               // glTF UV 기준
      this.posterAtlas.t.anisotropy = Math.min(8, this.world.renderer.capabilities.getMaxAnisotropy());
    }
    const { c, g, t } = this.posterAtlas;
    const SW = c.width / 4, SH = c.height / 2;
    g.fillStyle = '#111';
    g.fillRect(0, 0, c.width, c.height);
    imgs.forEach((im, i) => {
      if (!im) return;
      // 라이트박스 실제 비율(7:10)로 가운데를 잘라 칸에 채운다 (칸 픽셀 비율이 달라도 UV가 실제 비율로 되돌림)
      const a = 0.7;
      let sw = im.width, sh = im.height;
      if (sw / sh > a) sw = sh * a; else sh = sw / a;
      g.drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, (i % 4) * SW, Math.floor(i / 4) * SH, SW, SH);
    });
    t.needsUpdate = true;
    for (const m of mats) {
      for (const k of ['map', 'emissiveMap']) {
        if (m[k] && m[k] !== t) { m[k].dispose(); m[k] = t; }
      }
      m.needsUpdate = true;
    }
  }

  async _loadLobbyItem(item) {
    this.lobbyHls?.destroy(); this.lobbyHls = null;
    this.lobbyItem = item || null;
    this.lobbyImage = null;
    const v = this.lobbyVideo;
    v.pause();
    this.lobbyMat.map = this.lobbyCanvas.t;
    this.lobbyMat.needsUpdate = true;
    if (!item) { v.removeAttribute('src'); v.load(); return; }
    if (item.type === 'image') {
      const img = await loadImg(item.url);
      this.lobbyImage = img;
      this._lobbyT = 0;
      return;
    }
    if (item.type === 'hls') {
      const Hls = await getHls();
      if (Hls.isSupported()) { this.lobbyHls = new Hls(); this.lobbyHls.loadSource(item.url); this.lobbyHls.attachMedia(v); }
      else v.src = item.url;
    } else v.src = item.url;
    v.addEventListener('loadedmetadata', () => {
      // 모두 대략 같은 장면이 보이도록 서버 기준 시각으로 위치 맞춤
      const st = this.cfg?.lobby?.startedAt || 0;
      if (isFinite(v.duration) && v.duration > 0) v.currentTime = ((this.net.now() - st) / 1000) % v.duration;
      v.play().catch(() => {});
    }, { once: true });
  }

  _updateLobby(dt) {
    if (!this.lobbyCanvas) return;
    if (this.lobbyItem && this.lobbyItem.type !== 'image') {
      if (this.lobbyVideo.paused && this.lobbyVideo.readyState >= 2) this.lobbyVideo.play().catch(() => {});
      return;
    }
    this._lobbyT -= dt;
    if (this._lobbyT > 0) return;
    this._lobbyT = 1;
    const { c, g, t } = this.lobbyCanvas;
    const W = c.width, H = c.height;
    if (this.lobbyImage) {
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      const a = this.lobbyImage.width / this.lobbyImage.height;
      const w = a > W / H ? W : H * a, h = w / a;
      g.drawImage(this.lobbyImage, (W - w) / 2, (H - h) / 2, w, h);
      t.needsUpdate = true;
      return;
    }
    // 기본 화면: 배경 + 포스터 슬라이드 + 현재 상영작
    if (this.lobbyBg) g.drawImage(this.lobbyBg, 0, 0, W, H);
    else { g.fillStyle = '#120a24'; g.fillRect(0, 0, W, H); }
    const now = this.net.now();
    if (this.posters.length) {
      const k = Math.floor(now / 8000) % this.posters.length;
      const p = this.posters[k];
      const ph = H * 0.86, pw = ph * p.width / p.height;
      g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 30;
      g.drawImage(p, W * 0.06, (H - ph) / 2, pw, ph);
      g.shadowBlur = 0;
    }
    const x = W * 0.06 + H * 0.86 * 0.7 + 60;
    g.textAlign = 'left';
    g.fillStyle = '#e3192a';
    g.font = 'bold 44px Arial, sans-serif';
    g.fillText('EOTTE CINEMA', x, H * 0.22);
    g.fillStyle = '#fff';
    g.font = 'bold 54px "Malgun Gothic", sans-serif';
    g.fillText('사이버 홍대입구', x, H * 0.36);
    const s = this.snap;
    g.font = '34px "Malgun Gothic", sans-serif';
    g.fillStyle = '#d8ccff';
    g.fillText(s?.status === 'playing' ? 'NOW PLAYING · 4관 폭음시네마' : '4관 폭음시네마', x, H * 0.52);
    g.fillStyle = '#fff';
    g.font = 'bold 42px "Malgun Gothic", sans-serif';
    const title = (s?.title || '상영 대기 중');
    wrapCanvas(g, title, x, H * 0.64, W - x - 50, 54, 2);
    const d = new Date(now);
    g.font = 'bold 40px Arial, sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.fillText(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, x, H * 0.9);
    t.needsUpdate = true;
  }
}

function wrapCanvas(g, text, x, y, maxW, lh, maxLines) {
  let line = '';
  let n = 0;
  for (const ch of text) {
    if (g.measureText(line + ch).width > maxW) {
      if (++n >= maxLines) { g.fillText(line.slice(0, -1) + '…', x, y); return; }
      g.fillText(line, x, y);
      y += lh; line = '';
    }
    line += ch;
  }
  g.fillText(line, x, y);
}
