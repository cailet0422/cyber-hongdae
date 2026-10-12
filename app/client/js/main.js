// 사이버 홍대입구 클라이언트 진입점
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Net, prefs } from './net.js';
import { World } from './world.js';
import { AvatarFactory, CHAR_INFO, EMOTES, ANIM } from './avatar.js';
import { Player } from './player.js';
import { Cinema } from './screen.js';
import { ACCEPT, packFiles, loadTemplate } from './custom-model.js';

const $ = (id) => document.getElementById(id);
const CHARS = Object.keys(CHAR_INFO);
const isTouch = matchMedia('(pointer: coarse)').matches;

// ------------------------------------------------------------------ 렌더러 (입장 화면 동안 맵 미리 로드)
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050508);
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.05, 300);
let composer = null;

function applyQuality() {
  const q = prefs.quality;
  const dpr = devicePixelRatio || 1;
  renderer.setPixelRatio(q === 'low' ? Math.min(dpr, 1) * 0.75 : q === 'mid' ? Math.min(dpr, 1.25) : Math.min(dpr, 2));
  renderer.setSize(innerWidth, innerHeight, false);
  composer = null;
  if (q === 'high') {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.25, 0.2, 3.0));
    composer.addPass(new OutputPass());
  }
}
applyQuality();
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
  composer?.setSize(innerWidth, innerHeight);
});

const world = new World(scene, renderer);
let mapProgress = 0;
const worldReady = world.load('/assets/map/cinema.glb', (p) => (mapProgress = p));
const factory = new AvatarFactory();

// ------------------------------------------------------------------ 입장 화면
let info = null;
let chosen = prefs.char && CHARS.includes(prefs.char) ? prefs.char : CHARS[Math.floor(Math.random() * 5)];

function charCards(el, compact, onPick) {
  el.innerHTML = '';
  for (const id of CHARS) {
    const c = CHAR_INFO[id];
    const d = document.createElement('div');
    d.className = 'char' + (id === chosen ? ' sel' : '');
    d.style.setProperty('--c', c.color);
    d.innerHTML = `<div class="face">${c.name[0]}</div><div class="nm">${c.name}</div><div class="inst">${c.inst}</div>`;
    d.onclick = () => onPick(id);
    el.appendChild(d);
  }
}
const pickEntry = (id) => { chosen = id; prefs.char = id; charCards($('charPick'), false, pickEntry); factory.loadModel(id); };
charCards($('charPick'), false, pickEntry);
factory.loadModel(chosen);

fetch('/api/info').then((r) => r.json()).then((j) => {
  info = j;
  factory.setAssets(j.assets);
  $('serverName').textContent = j.name;
  document.title = j.name;
  $('serverInfo').textContent = `현재 ${j.online}명 접속 중 · 최대 ${j.max}명`;
  if (j.needPassword) $('pwRow').classList.remove('hidden');
  if (j.customModels?.enabled === false) $('entryModelBox').classList.add('hidden');
  $('enterBtn').disabled = false;
  if (new URLSearchParams(location.search).has('auto')) enter();
}).catch(() => { $('serverInfo').textContent = '서버에 연결할 수 없습니다.'; factory.setAssets(null); });

$('pwInput').addEventListener('keydown', (e) => e.key === 'Enter' && $('enterBtn').click());
$('modelFile').accept = ACCEPT;
const entryPick = async (input) => {
  const packed = await pickModel(input.files, $('entryModelStatus'));
  input.value = '';
  pendingModel = packed;
  $('entryModelClear').classList.toggle('hidden', !packed);
};
$('modelFile').onchange = () => entryPick($('modelFile'));
$('modelDir').onchange = () => entryPick($('modelDir'));
$('entryModelClear').onclick = () => { pendingModel = null; prefs.customModel = null; $('entryModelStatus').textContent = '선택 안 함 (기본 캐릭터)'; $('entryModelClear').classList.add('hidden'); };
if (prefs.customModel) { $('entryModelStatus').textContent = `지난번 모델: ${prefs.customModel.name}`; $('entryModelClear').classList.remove('hidden'); }
$('enterBtn').onclick = enter;

// ------------------------------------------------------------------ 모바일: 전체화면 + 가로 고정
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
const canFullscreen = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
const portrait = matchMedia('(orientation: portrait)');
let portraitOk = false; // '세로로 계속하기'를 고르면 가로로 고정하지 않음

// 브라우저가 터치(클릭) 없이는 전체화면을 막으므로 터치 이벤트 안에서 불러야 함
async function goFullscreen(force) {
  if (!isTouch || !(prefs.fullscreen || force)) return;
  const el = document.documentElement;
  try {
    if (!fsEl()) await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.());
    if (!portraitOk) await screen.orientation?.lock?.('landscape');   // 안드로이드: 전체화면일 때만 고정 가능
  } catch {}   // 아이폰처럼 지원하지 않으면 세로 화면 안내로 대신함
}
function exitFullscreen() {
  try { screen.orientation?.unlock?.(); } catch {}
  if (fsEl()) (document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen?.())?.catch?.(() => {});
}
const updateRotateHint = () => $('rotateHint').classList.toggle('hidden', !(isTouch && portrait.matches && !portraitOk));
portrait.addEventListener('change', updateRotateHint);
updateRotateHint();
$('rotateGo').classList.toggle('hidden', !canFullscreen);
$('rotateGo').onclick = () => { portraitOk = false; goFullscreen(true); };
$('rotateSkip').onclick = () => { portraitOk = true; updateRotateHint(); };

// ------------------------------------------------------------------ 게임 상태
const net = new Net();
let audioCtx = null;
let me = null;          // welcome 정보
let player = null;
let cinema = null;
let localAvatar = null;
const remotes = new Map(); // id → { info, avatar, target, yaw, anim, seat }
let cfg = null;

async function enter() {
  goFullscreen();   // 입장 버튼 터치로 전체화면 + 가로 고정 (모바일)
  $('enterBtn').disabled = true;
  $('entryErr').textContent = '';
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();
  } catch {}
  let welcome;
  try {
    welcome = await net.connect({ clientId: prefs.clientId, char: chosen, password: $('pwInput').value });
  } catch (e) {
    $('entryErr').textContent = e.message;
    if (e.password) $('pwRow').classList.remove('hidden');
    $('enterBtn').disabled = false;
    return;
  }
  me = welcome;
  $('entry').classList.add('hidden');
  $('loading').classList.remove('hidden');
  const prog = setInterval(() => { $('loadingBar').style.width = `${Math.round(mapProgress * 90)}%`; }, 100);
  try {
    await worldReady;
    $('loadingText').textContent = '캐릭터를 불러오는 중…';
    await start(welcome);
  } catch (e) {
    console.error(e);
    $('loadingText').textContent = '불러오기 실패: ' + e.message;
    return;
  } finally { clearInterval(prog); }
  $('loading').classList.add('hidden');
  $('hud').classList.remove('hidden');
}

async function start(w) {
  cfg = w.cfg;
  player = new Player({ world, camera, canvas, prefs });
  player.onStandRequest = standUp;
  cinema = new Cinema({ world, scene, net, prefs });
  if (audioCtx) cinema.attachAudio(audioCtx);
  cinema.onAutoplayBlocked = () => $('unmute').classList.remove('hidden');
  cinema.applyConfig(cfg);
  cinema.applyPlayback(w.pb);
  updateNowPlaying(w.pb);

  localAvatar = await factory.create(w.char, { isLocal: true });
  player.avatar = localAvatar;
  scene.add(localAvatar.root);
  localAvatar.setStick({ on: false, color: prefs.stickColor, colorHex: stickHex(prefs.stickColor) });
  uploadToken = w.uploadToken;
  // 입장 화면에서 고른 모델 업로드, 또는 지난번 모델 다시 적용
  if (pendingModel) applyPendingModel();
  else if (prefs.customModel && cfg.customModels?.enabled !== false) { myModel = prefs.customModel; net.send({ t: 'model', model: myModel }); rebuildLocal(); }

  $('myNick').textContent = w.nick;
  $('myDot').style.background = CHAR_INFO[w.char].color;
  for (const u of w.users) addRemote(u);
  updateOnline();
  for (const m of w.chat) chatLine(m, false);
  chatLine({ t: 'sys', text: `${w.nick} 님, 사이버 홍대입구에 오신 것을 환영합니다!${isTouch ? '' : ' (E 착석 · F 응원봉 · G 이모트 · Enter 채팅)'}` });
  buildUi();
  net.addEventListener('msg', (e) => onMsg(e.detail));
  net.addEventListener('close', (e) => {
    if (!$('kicked').classList.contains('hidden')) return;
    showKicked(e.detail.code === 1001 ? '서버가 닫혔습니다.' : '서버와의 연결이 끊어졌습니다.');
  });
  if (isTouch) {
    $('joy').classList.remove('hidden');
    $('mobileUse').classList.remove('hidden');
    $('mobileJump').classList.remove('hidden');
    $('chatInput').placeholder = '채팅 입력…';
    $('unmute').textContent = '🔇 화면을 터치하면 소리가 켜집니다';
    player.bindJoystick($('joy'), $('joyKnob'));
    player.bindJump($('mobileJump'));
    $('mobileUse').onclick = useKey;
    // 뒤로가기·앱 전환으로 전체화면이 풀렸으면 다음 터치 때 다시 전체화면으로
    addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' && !fsEl() && !e.target.closest?.('#settings, #rotateHint')) goFullscreen();
    }, true);
  }
  last = performance.now();
  requestAnimationFrame(loop);
}

function stickHex(i) { return cfg?.stickColors?.[i]?.color || ['#ff2a2a', '#2f6bff', '#ffd400', '#ff69b4', '#22d45a'][i] || '#ff2a2a'; }

// ------------------------------------------------------------------ 원격 아바타
function addRemote(u) {
  const r = { info: u, avatar: null, target: new THREE.Vector3(u.st[0], u.st[1], u.st[2]), yaw: u.st[3], anim: u.st[4], seat: u.seat, pos: new THREE.Vector3(u.st[0], u.st[1], u.st[2]), lastPos: new THREE.Vector3() };
  remotes.set(u.id, r);
  if (u.seat) occupy(u.seat, u.id);
  loadRemoteAvatar(r);
  updateOnline();
}
async function loadRemoteAvatar(r) {
  const char = r.info.char;
  const model = prefs.showCustom ? r.info.model : null;
  const token = (r.loadToken = (r.loadToken || 0) + 1);
  const av = await factory.create(char, { nick: r.info.nick, model });
  if (!remotes.has(r.info.id) || r.loadToken !== token) { av.dispose(); return; }
  r.avatar?.dispose();
  r.avatar = av;
  scene.add(av.root);
  av.setStick({ ...r.info.stick, colorHex: stickHex(r.info.stick?.color || 0) });
  if (r.info.emote) av.setEmote(r.info.emote);
  if (r.pendingSay) { av.say(r.pendingSay); r.pendingSay = null; }
}
function removeRemote(id) {
  const r = remotes.get(id);
  if (!r) return;
  if (r.seat) occupy(r.seat, null, id);
  r.avatar?.dispose();
  remotes.delete(id);
  updateOnline();
}
function occupy(seatId, uid, prevUid) {
  const s = world.seatById.get(seatId);
  if (!s) return;
  if (uid == null) { if (s.occupant === prevUid || prevUid == null) s.occupant = null; }
  else s.occupant = uid;
}
function updateOnline() { $('onlineCount').textContent = remotes.size + 1; }

// ------------------------------------------------------------------ 네트워크 메시지
function onMsg(m) {
  switch (m.t) {
    case 'P':
      for (const [id, x, y, z, yaw, anim] of m.d) {
        if (id === me.id) continue;
        const r = remotes.get(id);
        if (!r) continue;
        r.target.set(x, y, z); r.yaw = yaw; r.anim = anim;
      }
      break;
    case 'join': addRemote(m.u); break;
    case 'leave': removeRemote(m.id); break;
    case 'chat': {
      chatLine(m);
      const av = m.id === me.id ? localAvatar : remotes.get(m.id)?.avatar;
      if (prefs.showBubbles) {
        if (av) av.say(m.text);
        else if (remotes.get(m.id)) remotes.get(m.id).pendingSay = m.text;
      }
      break;
    }
    case 'sys': case 'notice': chatLine(m); if (m.t === 'notice') toast('📢 ' + m.text, 6000); break;
    case 'chatclear': $('chatLog').innerHTML = ''; break;
    case 'char': {
      const r = remotes.get(m.id);
      if (r) { r.info.char = m.char; r.avatar?.dispose(); r.avatar = null; loadRemoteAvatar(r); }
      break;
    }
    case 'emote': { const r = remotes.get(m.id); if (r) { r.info.emote = m.e; r.avatar?.setEmote(m.e); } break; }
    case 'stick': {
      const r = remotes.get(m.id);
      if (r) { r.info.stick = m.s; r.avatar?.setStick({ ...m.s, colorHex: stickHex(m.s.color) }); }
      break;
    }
    case 'seat': {
      if (m.id === me.id) {
        if (m.seat) { const s = world.seatById.get(m.seat); if (s) { occupy(m.seat, me.id); player.sitAt(s); localAvatar.setEmote(null); } }
        break;
      }
      const r = remotes.get(m.id);
      if (!r) break;
      if (r.seat) occupy(r.seat, null, m.id);
      r.seat = m.seat;
      if (m.seat) occupy(m.seat, m.id);
      break;
    }
    case 'sitfail': toast('이미 다른 사람이 앉은 자리입니다.'); break;
    case 'model': {
      const r = remotes.get(m.id);
      if (r) { r.info.model = m.model; loadRemoteAvatar(r); }
      break;
    }
    case 'modelfail': case 'modelreset':
      toast('⚠ ' + m.reason, 5000);
      prefs.customModel = null; myModel = null; rebuildLocal(); renderModelUi();
      break;
    case 'pb': cinema.applyPlayback(m.d); updateNowPlaying(m.d); break;
    case 'pbs': cinema.syncTick(m); break;
    case 'cfg':
      cfg = m.d; cinema.applyConfig(cfg);
      buildStickBar();
      break;
    case 'kicked': showKicked(m.reason); break;
  }
}

function showKicked(reason) {
  $('kickedReason').textContent = reason;
  $('kicked').classList.remove('hidden');
  $('hud').classList.add('hidden');
  try { cinema?.video.pause(); cinema?.lobbyVideo.pause(); } catch {}
}

function updateNowPlaying(pb) {
  const el = $('nowPlaying');
  if (!pb || pb.status === 'stopped') { el.textContent = ''; return; }
  const icon = pb.status === 'playing' ? '▶' : pb.status === 'paused' ? '⏸' : '⏳';
  el.textContent = `${icon} 4관 상영: ${pb.title || ''}${pb.status === 'preparing' && pb.prepare ? ` (${pb.prepare.text || '준비 중'} ${Math.round((pb.prepare.progress || 0) * 100)}%)` : ''}`;
}

// ------------------------------------------------------------------ 채팅 & UI
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function chatLine(m, scroll = true) {
  const log = $('chatLog');
  const d = document.createElement('div');
  d.className = 'm' + (m.t === 'sys' ? ' sys' : m.t === 'notice' ? ' notice' : '');
  if (m.t === 'chat') d.innerHTML = `<b style="color:${CHAR_INFO[m.char]?.color || '#fff'}">${esc(m.nick)}</b>${esc(m.text)}`;
  else if (m.t === 'notice') d.textContent = '📢 [공지] ' + m.text;
  else d.textContent = m.text;
  log.appendChild(d);
  while (log.children.length > 150) log.firstChild.remove();
  if (scroll) log.scrollTop = log.scrollHeight;
}
let toastT = null;
function toast(text, ms = 2500) {
  const t = $('toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.add('hidden'), ms);
}

function buildUi() {
  const input = $('chatInput');
  $('chatForm').onsubmit = (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text) net.send({ t: 'chat', text });
    input.value = '';
    input.blur();
  };
  input.addEventListener('focus', () => $('chat').classList.add('active'));
  input.addEventListener('blur', () => $('chat').classList.remove('active'));
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') input.blur(); e.stopPropagation(); });

  // 이모트
  const list = $('emoteList');
  for (const e of EMOTES) {
    if (e.vpd && !factory.hasPose(e.vpd)) continue; // 포즈 파일(모델 팩)이 있을 때만
    const b = document.createElement('button');
    b.innerHTML = `<i>${e.icon}</i>${e.label}`;
    b.onclick = () => { doEmote(e.id); $('emotePanel').classList.add('hidden'); };
    list.appendChild(b);
  }
  const stopBtn = document.createElement('button');
  stopBtn.innerHTML = '<i>✋</i>그만하기';
  stopBtn.onclick = () => { doEmote(null); $('emotePanel').classList.add('hidden'); };
  list.appendChild(stopBtn);

  $('btnEmote').onclick = () => togglePanel('emotePanel');
  $('btnStick').onclick = () => toggleStick();
  $('btnView').onclick = () => toggleView();
  $('btnSettings').onclick = () => togglePanel('settings');
  $('btnHideGui').onclick = () => setGui(false);
  $('guiShow').onclick = () => setGui(true);
  $('closeSettings').onclick = () => $('settings').classList.add('hidden');
  $('stickWave').onclick = () => setStick({ wave: !localAvatar.stick.wave });
  $('stickOff').onclick = () => toggleStick(false);
  buildStickBar();
  $('unmute').onclick = () => { audioCtx?.resume(); cinema.video.play().catch(() => {}); $('unmute').classList.add('hidden'); };
  canvas.addEventListener('pointerdown', () => { if (audioCtx?.state === 'suspended') audioCtx.resume(); });

  // 설정
  const bindRange = (id, key, fmt) => {
    const el = $(id);
    el.value = prefs[key];
    const show = () => fmt && ($(fmt[0]).textContent = fmt[1](prefs[key]));
    show();
    el.oninput = () => { prefs[key] = +el.value; show(); };
  };
  bindRange('volume', 'volume', ['volVal', (v) => Math.round(v * 100) + '%']);
  bindRange('lobbyVolume', 'lobbyVolume', ['lvolVal', (v) => Math.round(v * 100) + '%']);
  bindRange('subSize', 'subSize', ['subVal', (v) => Math.round(v * 100) + '%']);
  bindRange('sens', 'sens');
  bindRange('maxAvatars', 'maxAvatars', ['maxAvVal', (v) => v + '명']);
  for (const k of ['showNames', 'showBubbles', 'showSubs', 'mouseLock', 'fullscreen']) {
    $(k).checked = prefs[k];
    $(k).onchange = () => {
      prefs[k] = $(k).checked;
      if (k === 'mouseLock' && !prefs[k]) player.unlockMouse();
      if (k === 'fullscreen') prefs[k] ? goFullscreen() : exitFullscreen();
    };
  }
  $('mouseLockRow').classList.toggle('hidden', isTouch);
  $('fullscreenRow').classList.toggle('hidden', !isTouch || !canFullscreen);
  player.onLockChange = (locked) => { if (locked) toast('🖱 마우스로 시점 조작 · Alt를 누르면 커서가 나와요', 2400); };
  const qs = [...$('quality').children];
  const markQ = () => qs.forEach((b) => b.classList.toggle('sel', b.dataset.q === prefs.quality));
  qs.forEach((b) => (b.onclick = () => { prefs.quality = b.dataset.q; markQ(); applyQuality(); }));
  markQ();
  const pick2 = (id) => {
    if (id === localAvatar.char) return;
    chosen = id; prefs.char = id;
    charCards($('charPick2'), true, pick2);

  // 커스텀 모델 설정
  const onFiles = async (input) => {
    const packed = await pickModel(input.files, $('modelStatus'));
    input.value = '';
    if (packed) { pendingModel = packed; applyPendingModel(); }
  };
  $('modelFile2').accept = ACCEPT;
  $('modelFile2').onchange = () => onFiles($('modelFile2'));
  $('modelDir2').onchange = () => onFiles($('modelDir2'));
  $('modelReset').onclick = () => { myModel = null; prefs.customModel = null; net.send({ t: 'model', model: null }); rebuildLocal(); renderModelUi(); toast('기본 캐릭터로 돌아왔습니다'); };
  $('modelHeight').value = prefs.modelHeight;
  $('modelHeightVal').textContent = prefs.modelHeight.toFixed(2) + 'm';
  $('modelHeight').oninput = () => { prefs.modelHeight = +$('modelHeight').value; $('modelHeightVal').textContent = prefs.modelHeight.toFixed(2) + 'm'; };
  $('modelHeight').onchange = updateModelOptions;
  $('modelFlip').checked = !!prefs.modelFlip;
  $('modelFlip').onchange = () => { prefs.modelFlip = $('modelFlip').checked; updateModelOptions(); };
  $('showCustom').checked = prefs.showCustom;
  $('showCustom').onchange = () => { prefs.showCustom = $('showCustom').checked; for (const r of remotes.values()) if (r.info.model) loadRemoteAvatar(r); };
  $('customModelBox').classList.toggle('hidden', cfg.customModels?.enabled === false);
  renderModelUi();
    changeChar(id);
  };
  charCards($('charPick2'), true, pick2);

  // 커스텀 모델 설정
  const onFiles = async (input) => {
    const packed = await pickModel(input.files, $('modelStatus'));
    input.value = '';
    if (packed) { pendingModel = packed; applyPendingModel(); }
  };
  $('modelFile2').accept = ACCEPT;
  $('modelFile2').onchange = () => onFiles($('modelFile2'));
  $('modelDir2').onchange = () => onFiles($('modelDir2'));
  $('modelReset').onclick = () => { myModel = null; prefs.customModel = null; net.send({ t: 'model', model: null }); rebuildLocal(); renderModelUi(); toast('기본 캐릭터로 돌아왔습니다'); };
  $('modelHeight').value = prefs.modelHeight;
  $('modelHeightVal').textContent = prefs.modelHeight.toFixed(2) + 'm';
  $('modelHeight').oninput = () => { prefs.modelHeight = +$('modelHeight').value; $('modelHeightVal').textContent = prefs.modelHeight.toFixed(2) + 'm'; };
  $('modelHeight').onchange = updateModelOptions;
  $('modelFlip').checked = !!prefs.modelFlip;
  $('modelFlip').onchange = () => { prefs.modelFlip = $('modelFlip').checked; updateModelOptions(); };
  $('showCustom').checked = prefs.showCustom;
  $('showCustom').onchange = () => { prefs.showCustom = $('showCustom').checked; for (const r of remotes.values()) if (r.info.model) loadRemoteAvatar(r); };
  $('customModelBox').classList.toggle('hidden', cfg.customModels?.enabled === false);
  renderModelUi();

  addEventListener('keydown', onKey);
}

// GUI 숨기기: 화면(영화)만 보이게. 다시 보기 버튼·알림·소리 켜기 안내는 남김
function setGui(on) {
  $('hud').classList.toggle('gui-off', !on);
  if (on) return;
  document.activeElement?.blur?.();
  toast(isTouch ? 'GUI를 숨겼습니다 · 오른쪽 위 👁 버튼으로 다시 보기' : 'GUI를 숨겼습니다 · H 키로 다시 보기', 3000);
}
const guiOff = () => $('hud').classList.contains('gui-off');

function togglePanel(id) {
  for (const p of ['emotePanel', 'settings', 'stickBar']) if (p !== id && !(p === 'stickBar' && localAvatar.stick.on)) $(p).classList.add('hidden');
  $(id).classList.toggle('hidden');
  if (!$(id).classList.contains('hidden')) player.unlockMouse();   // 메뉴를 열면 클릭할 수 있게 커서를 꺼냄
}

function buildStickBar() {
  const el = $('stickColors');
  if (!el || !localAvatar) return;
  el.innerHTML = '';
  (cfg?.stickColors || []).forEach((c, i) => {
    const b = document.createElement('button');
    b.style.setProperty('--c', c.color);
    b.title = c.name;
    b.className = i === localAvatar.stick.color ? 'sel' : '';
    b.onclick = () => setStick({ color: i, on: true });
    el.appendChild(b);
  });
}

function setStick(patch) {
  const s = { ...localAvatar.stick, ...patch };
  if (patch.color != null) prefs.stickColor = s.color;
  s.colorHex = stickHex(s.color);
  localAvatar.setStick(s);
  net.send({ t: 'stick', on: s.on, color: s.color, wave: s.wave });
  $('btnStick').classList.toggle('on', s.on);
  $('stickBar').classList.toggle('hidden', !s.on);
  $('stickWave').classList.toggle('primary', !!s.wave);
  buildStickBar();
}
function toggleStick(force) {
  const on = force ?? !localAvatar.stick.on;
  setStick({ on, wave: on ? localAvatar.stick.wave : false });
  if (on) toast(`응원봉: ${cfg?.stickColors?.[localAvatar.stick.color]?.name || ''} 컬러 · C 색 바꾸기 · X 흔들기`);
}
function toggleView() {
  player.firstPerson = !player.firstPerson;
  prefs.firstPerson = player.firstPerson;
  $('crosshair').classList.toggle('hidden', !player.firstPerson);
}
function doEmote(id) {
  localAvatar.setEmote(id);
  net.send({ t: 'emote', e: id });
}

async function changeChar(id) {
  net.send({ t: 'char', char: id });
  await rebuildLocal(id);
  toast(myModel ? `${CHAR_INFO[id].name} 컬러로 변경했습니다 (커스텀 모델 사용 중)` : `${CHAR_INFO[id].name}(으)로 변경했습니다.`);
}

// 내 아바타 다시 만들기 (캐릭터/커스텀 모델 변경 시)
async function rebuildLocal(char = localAvatar?.char || chosen) {
  const token = (rebuildLocal.token = (rebuildLocal.token || 0) + 1);
  const av = await factory.create(char, { isLocal: true, model: myModel, onCustomError: (e) => toast('⚠ 모델을 불러오지 못해 기본 캐릭터를 씁니다: ' + e.message, 6000) });
  if (token !== rebuildLocal.token) { av.dispose(); return; }
  const old = localAvatar;
  localAvatar = av;
  player.avatar = av;
  scene.add(av.root);
  av.setStick({ ...old.stick });
  old.dispose();
  $('myDot').style.background = CHAR_INFO[char].color;
}

// ------------------------------------------------------------------ 커스텀 3D 모델
let uploadToken = null;
let pendingModel = null; // 입장 전 고른 모델 { data, ext, name }
let myModel = null;      // 현재 적용된 모델 { id, ext, name, height, flip }

async function pickModel(files, statusEl) {
  if (!files?.length) return null;
  statusEl.textContent = '모델 확인 중…';
  try {
    const packed = await packFiles(files);
    const max = (cfg?.customModels?.maxMB || info?.customModels?.maxMB || 60) * 1048576;
    if (packed.data.length > max) throw new Error(`파일이 너무 큽니다 (${(packed.data.length / 1048576).toFixed(1)}MB, 최대 ${max / 1048576}MB)`);
    const tpl = await loadTemplate({ data: packed.data, ext: packed.ext });
    statusEl.textContent = `✅ ${packed.name} · ${Math.round(tpl.triangles / 1000)}k 폴리곤${tpl.kind === 'vrm' ? ' · VRM' : ''}`;
    return packed;
  } catch (e) {
    statusEl.textContent = '❌ ' + e.message;
    return null;
  }
}

function uploadModel(packed, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', '/api/avatar');
    x.setRequestHeader('x-upload-token', uploadToken);
    x.setRequestHeader('x-file-name', encodeURIComponent(packed.name.endsWith('.' + packed.ext) ? packed.name : packed.name + '.' + packed.ext));
    x.upload.onprogress = (e) => e.total && onProgress?.(e.loaded / e.total);
    x.onload = () => {
      let j = {};
      try { j = JSON.parse(x.responseText); } catch {}
      if (x.status === 200) resolve(j); else reject(new Error(j.error || '업로드 실패 (' + x.status + ')'));
    };
    x.onerror = () => reject(new Error('업로드 중 연결이 끊어졌습니다'));
    x.send(new Blob([packed.data]));
  });
}

async function applyPendingModel() {
  const packed = pendingModel;
  pendingModel = null;
  if (!packed) return;
  if (cfg.customModels?.enabled === false) return toast('이 서버는 커스텀 모델을 허용하지 않습니다', 4000);
  try {
    toast('모델 올리는 중…', 60000);
    const r = await uploadModel(packed, (p) => toast(`모델 올리는 중… ${Math.round(p * 100)}%`, 60000));
    myModel = { id: r.id, ext: r.ext, name: packed.name, height: prefs.modelHeight || 1.6, flip: !!prefs.modelFlip };
    prefs.customModel = myModel;
    net.send({ t: 'model', model: myModel });
    await rebuildLocal();
    toast('✅ 내 3D 모델을 적용했습니다');
  } catch (e) {
    toast('⚠ ' + e.message, 6000);
  }
  renderModelUi();
}

function updateModelOptions() {
  if (!myModel) return;
  myModel = { ...myModel, height: prefs.modelHeight, flip: !!prefs.modelFlip };
  prefs.customModel = myModel;
  net.send({ t: 'model', model: myModel });
  clearTimeout(updateModelOptions.t);
  updateModelOptions.t = setTimeout(() => rebuildLocal(), 250);
}

function renderModelUi() {
  const el = $('myModelName');
  if (!el) return;
  el.textContent = myModel ? `사용 중: ${myModel.name}` : '기본 캐릭터 사용 중';
  $('modelReset').classList.toggle('hidden', !myModel);
  $('modelOpts').classList.toggle('hidden', !myModel);
}

function useKey() {
  if (player.seat) return standUp();
  const s = player.nearestSeat();
  if (s) net.send({ t: 'sit', seat: s.id });
}
function standUp() {
  if (!player.seat) return;
  occupy(player.seat.id, null, me.id);
  player.stand();
  net.send({ t: 'stand' });
}

// 모바일 착석 버튼: 앉아 있으면 '일어나기', 근처에 빈 좌석이 없으면 흐리게
let useBtnState = '';
function setUseBtn(state) {
  if (state === useBtnState) return;
  useBtnState = state;
  $('mobileUse').innerHTML = state === 'stand' ? '<i>🧍</i><span>일어나기</span>' : '<i>🪑</i><span>착석</span>';
  $('mobileUse').classList.toggle('off', state === 'none');
}

function onKey(e) {
  if (/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  switch (e.code) {
    case 'Enter': e.preventDefault(); if (guiOff()) setGui(true); $('chatInput').focus(); break;
    case 'KeyH': setGui(guiOff()); break;
    case 'KeyE': useKey(); break;
    case 'KeyF': toggleStick(); break;
    case 'KeyC': if (localAvatar.stick.on) setStick({ color: (localAvatar.stick.color + 1) % (cfg?.stickColors?.length || 5) }); break;
    case 'KeyX': if (localAvatar.stick.on) setStick({ wave: !localAvatar.stick.wave }); break;
    case 'KeyG': togglePanel('emotePanel'); break;
    case 'KeyV': toggleView(); break;
    case 'Escape':
      if (guiOff()) setGui(true);
      else if (!$('emotePanel').classList.contains('hidden')) $('emotePanel').classList.add('hidden');
      else togglePanel('settings');
      break;
    default:
      if (/^Digit[1-9]$/.test(e.code) && !$('emotePanel').classList.contains('hidden')) {
        const em = EMOTES[+e.code.slice(5) - 1];
        if (em) { doEmote(em.id); $('emotePanel').classList.add('hidden'); }
      }
  }
}

// ------------------------------------------------------------------ 루프
let last = 0;
let sendT = 0;
let lastSent = '';
const tmpV = new THREE.Vector3();

function placeOnSeat(av, seat) {
  av.root.position.set(seat.pos.x - Math.sin(seat.yaw) * 0.06, seat.pos.y - av.hipHeight - 0.02, seat.pos.z - Math.cos(seat.yaw) * 0.06);
  av.root.rotation.y = seat.yaw;
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  player.update(dt);
  // 로컬 아바타
  const la = localAvatar;
  if (player.seat) placeOnSeat(la, player.seat);
  else { la.root.position.copy(player.pos); la.root.rotation.y = player.yaw; }
  la.anim = player.anim;
  la.speed = player.speed;
  if (la.emote && (player.anim === ANIM.walk || player.anim === ANIM.run || player.anim === ANIM.air)) doEmote(null);
  la.update(dt);

  // 상태 전송 (10Hz, 변화 있을 때)
  sendT -= dt;
  if (sendT <= 0) {
    sendT = 0.1;
    const st = player.netState().map((v, i) => (i < 3 ? Math.round(v * 100) / 100 : i === 3 ? Math.round(v * 100) / 100 : v));
    const key = st.join(',');
    if (key !== lastSent) { lastSent = key; net.send({ t: 'p', d: st }); }
  }

  // 원격 아바타: 보간 + 가까운 순 표시 제한
  const camPos = camera.position;
  const list = [];
  for (const r of remotes.values()) {
    if (!r.avatar) continue;
    const av = r.avatar;
    if (r.seat && world.seatById.get(r.seat)) {
      placeOnSeat(av, world.seatById.get(r.seat));
      av.anim = ANIM.sit;
    } else {
      r.pos.lerp(r.target, Math.min(1, dt * 10));
      if (r.pos.distanceToSquared(r.target) > 25) r.pos.copy(r.target);
      av.root.position.copy(r.pos);
      let d = r.yaw - av.root.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      av.root.rotation.y += d * Math.min(1, dt * 10);
      av.anim = r.anim === ANIM.sit ? ANIM.idle : r.anim;
      av.speed = r.lastPos.distanceTo(r.pos) / Math.max(dt, 1e-3);
      r.lastPos.copy(r.pos);
    }
    list.push({ av, d: camPos.distanceToSquared(av.root.position) });
  }
  list.sort((a, b) => a.d - b.d);
  list.forEach(({ av, d }, i) => {
    const vis = i < prefs.maxAvatars;
    av.root.visible = vis;
    if (av.tag) av.tag.visible = prefs.showNames && d < 900;
    if (vis) av.update(dt, d > 225);
    else if (av.stickObj) av.stickObj.visible = false;
  });

  // 상호작용 안내
  const pr = $('prompt');
  const near = player.seat ? null : player.nearestSeat();
  if (player.seat) {
    pr.innerHTML = isTouch ? `<kbd>일어나기</kbd> 버튼 또는 조이스틱으로 일어나기 · 좌석 ${player.seat.id}` : `<kbd>E</kbd> 또는 이동키로 일어나기 · 좌석 ${player.seat.id}`;
    pr.classList.remove('hidden');
  } else if (near) { pr.innerHTML = isTouch ? `<kbd>착석</kbd> 버튼으로 ${near.id} 좌석에 앉기` : `<kbd>E</kbd> ${near.id} 좌석에 앉기`; pr.classList.remove('hidden'); }
  else pr.classList.add('hidden');
  if (isTouch) setUseBtn(player.seat ? 'stand' : near ? 'sit' : 'none');

  const inTheater = world.inZone('theater4', player.pos.clone().add(tmpV.set(0, 1, 0)));
  const tz = world.zones.theater4;
  const theaterDist = tz ? tz.distanceToPoint(player.pos) : 30;
  const led = world.displays.lobby?.mesh;
  const lobbyDist = led && cinema.lobbyPlane ? cinema.lobbyPlane.position.distanceTo(player.pos) : 50;
  cinema.update(dt, { inTheater, theaterDist, lobbyDist });
  world.updateLights(dt, camPos, inTheater);

  if (composer) composer.render();
  else renderer.render(scene, camera);
}

// 디버그용
window.__cyber = { scene, camera, world, get player() { return player; }, get cinema() { return cinema; }, remotes, net, prefs };
