// 아바타: 기본 캐릭터(오리지널/MMD 팩) + 사용자 커스텀 모델(VRM/glTF/FBX/OBJ/PMX…)
// 어떤 리그든 "모델 공간에서 팔다리 방향을 조준"하는 방식으로 걷기·착석·이모트·응원봉을 같은 코드로 처리한다.
// 모델 공간: 아바타 루트 기준, +Z가 정면, +X가 캐릭터의 왼쪽, +Y가 위.
import * as THREE from 'three';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';
import { CCDIKSolver } from 'three/addons/animation/CCDIKSolver.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { createLightstick } from './lightstick.js';
import { buildProceduralBase } from './procedural-avatar.js';
import { loadTemplate, detectRig } from './custom-model.js';

export const SCALE = 0.08; // MMD 1단위 ≈ 8cm
export const CHAR_INFO = {
  yui: { name: '유이', inst: '기타', color: '#ff4848' },
  mio: { name: '미오', inst: '베이스', color: '#4d7cff' },
  ritsu: { name: '리츠', inst: '드럼', color: '#ffd23f' },
  mugi: { name: '무기', inst: '키보드', color: '#ff7eb6' },
  azusa: { name: '아즈사', inst: '기타', color: '#3fd46e' },
};
const INSTRUMENT_MORPHS = ['ギター縮小', 'ベース縮小', '鍵盤縮小', '右棒縮小', '左棒縮小', '猫みみ縮小'];
const FACE_MORPHS = {
  blink: ['まばたき', 'blink', 'Blink', 'eyeBlink', 'EyeBlink', 'Fcl_EYE_Close', 'eyes_closed', 'Eye_Close', 'eyeClose'],
  happy: ['笑い', 'にこ', 'happy', 'Happy', 'joy', 'Joy', 'smile', 'Smile', 'Fcl_ALL_Joy', 'Fcl_ALL_Fun'],
  angry: ['怒る', 'angry', 'Angry', 'Fcl_ALL_Angry'],
  sad: ['困る', 'sad', 'Sad', 'sorrow', 'Sorrow', 'Fcl_ALL_Sorrow'],
};

export const EMOTES = [
  { id: 'pose_yui', label: '유이 포즈', icon: '🎸', vpd: 'yui' },
  { id: 'pose_mio', label: '미오 포즈', icon: '🎸', vpd: 'mio' },
  { id: 'pose_ritsu', label: '리츠 포즈', icon: '🥁', vpd: 'ritsu' },
  { id: 'pose_mugi', label: '무기 포즈', icon: '🎹', vpd: 'mugi' },
  { id: 'pose_azusa', label: '아즈사 포즈', icon: '🐱', vpd: 'azusa' },
  { id: 'wave', label: '손 흔들기', icon: '👋' },
  { id: 'clap', label: '박수', icon: '👏' },
  { id: 'banzai', label: '만세', icon: '🙌' },
  { id: 'bow', label: '인사', icon: '🙇' },
  { id: 'dance', label: '흔들흔들', icon: '🎵' },
  { id: 'fight', label: '화이팅', icon: '✊' },
  { id: 'think', label: '고민', icon: '🤔' },
  { id: 'airguitar', label: '에어 기타', icon: '🎸' },
  { id: 'drum', label: '에어 드럼', icon: '🥁' },
];

export const ANIM = { idle: 0, walk: 1, run: 2, sit: 3, air: 4 };

const V = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _e = new THREE.Euler();
const LIMBS = [['lUpper', 'lLower', 'lHand'], ['rUpper', 'rLower', 'rHand'], ['lThigh', 'lShin', 'lFoot'], ['rThigh', 'rShin', 'rFoot']];
// 포즈 P의 방향 키 → 리그 키
const AIM = [['lArm', 'lUpper'], ['lFore', 'lLower'], ['rArm', 'rUpper'], ['rFore', 'rLower'], ['lThigh', 'lThigh'], ['lShin', 'lShin'], ['rThigh', 'rThigh'], ['rShin', 'rShin']];

// ------------------------------------------------------------------ 팩토리
export class AvatarFactory {
  constructor() {
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => url.replace(/\.tga$/i, '.webp'));
    manager.addHandler(/\.tga$/i, new THREE.TextureLoader(manager));
    this.loader = new MMDLoader(manager);
    this.builtin = new Map();
    this.custom = new Map();
    this.poses = new Map();
    this.assets = { models: [], poses: [] };
    this.assetsReady = new Promise((res) => (this._setAssets = res));
  }

  setAssets(a) { this.assets = { models: a?.models || [], poses: a?.poses || [] }; this._setAssets(); }
  hasPose(id) { return this.assets.poses.includes(id); }

  // 기본 캐릭터: MMD 팩이 설치되어 있으면 PMD, 아니면 오리지널 아바타
  loadBuiltin(char) {
    if (!this.builtin.has(char)) {
      this.builtin.set(char, this.assetsReady.then(() => new Promise((res) => {
        const procedural = () => {
          const b = buildProceduralBase(char);
          res({ kind: 'procedural', fixedScale: SCALE, mesh: b.mesh, faceStates: b.faceStates, faceMatIndex: b.faceMatIndex, instantiate: async () => ({ object: SkeletonUtils.clone(b.mesh) }) });
        };
        if (!this.assets.models.includes(char)) return procedural();
        this.loader.load(`/assets/models/${char}/model.pmd`, (mesh) => {
          res({ kind: 'mmd', fixedScale: SCALE, mesh, iks: mesh.geometry.userData.MMD?.iks || [], instantiate: async () => ({ object: SkeletonUtils.clone(mesh) }) });
        }, undefined, procedural);
      })));
    }
    return this.builtin.get(char);
  }
  // 하위 호환 (입장 화면 미리 불러오기)
  loadModel(char) { return this.loadBuiltin(char); }

  loadCustom(model) {
    const key = model.id + '.' + model.ext;
    if (!this.custom.has(key)) {
      const p = loadTemplate({ url: `/avatars/${model.id}.${model.ext}`, ext: model.ext });
      this.custom.set(key, p);
      p.catch(() => this.custom.delete(key));
    }
    return this.custom.get(key);
  }

  loadPose(id) {
    if (!this.hasPose(id)) return Promise.resolve(null);
    if (!this.poses.has(id)) {
      this.poses.set(id, new Promise((res) => this.loader.loadVPD(`/assets/poses/${id}.vpd`, false, res, undefined, () => res(null))));
    }
    return this.poses.get(id);
  }

  // model: { id, ext, name, height, flip } (커스텀 모델) 또는 null
  async create(char, opts = {}) {
    let tpl = null;
    if (opts.model && opts.allowCustom !== false) {
      try { tpl = await this.loadCustom(opts.model); }
      catch (e) { console.warn('커스텀 모델 실패', e); opts.onCustomError?.(e); }
    }
    if (!tpl) tpl = await this.loadBuiltin(char);
    const inst = await tpl.instantiate();
    return new Avatar(this, tpl, inst, char, { ...opts, custom: tpl.fixedScale ? null : opts.model });
  }
}

// ------------------------------------------------------------------ 아바타
export class Avatar {
  constructor(factory, tpl, inst, char, { nick = '', isLocal = false, custom = null } = {}) {
    this.factory = factory;
    this.tpl = tpl;
    this.kind = tpl.kind;
    this.char = char;
    this.isLocal = isLocal;
    this.custom = custom;
    this.vrm = inst.vrm || null;
    this.object = inst.object;
    this.root = new THREE.Group();
    this.inner = new THREE.Group();
    this.root.add(this.inner);
    this.inner.add(this.object);
    this.mesh = this.inner; // 카메라가 너무 가까울 때 숨기는 대상
    this.anim = ANIM.idle;
    this.speed = 0;
    this.phase = 0;
    this.time = Math.random() * 10;
    this.emote = null;
    this.emoteT = 0;
    this.vpd = null;
    this.blinkT = 2 + Math.random() * 3;
    this.stick = { on: false, color: 0, wave: false };
    this.stickObj = null;
    this.nick = nick;

    this._setupScale(custom);
    this._setupRig(custom);
    this._setupFace();
    this._setupMixer(inst.clips || tpl.clips || []);
    if (nick) this._makeNameTag(nick);
  }

  // ---------------------------------------------------------------- 크기/방향
  _setupScale(custom) {
    if (this.tpl.fixedScale) {
      this.inner.scale.setScalar(this.tpl.fixedScale);
      this.root.updateMatrixWorld(true);
      return;
    }
    const box = boxOf(this.object);
    const size = box.getSize(new THREE.Vector3());
    const h = size.y > 1e-6 ? size.y : Math.max(size.x, size.z, 1e-3);
    const target = THREE.MathUtils.clamp(+custom?.height || 1.6, 0.4, 3.0);
    this.inner.scale.setScalar(target / h);
    this.root.updateMatrixWorld(true);
  }

  _modelPos(node, out = new THREE.Vector3()) {
    return this.root.worldToLocal(node.getWorldPosition(out));
  }
  _modelQuat(node, out = new THREE.Quaternion()) {
    node.getWorldQuaternion(out);
    return out.premultiply(this.root.getWorldQuaternion(_q3).invert());
  }

  _setupRig(custom) {
    const rig = detectRig(this.object, this.vrm);
    this.bones = rig.bones;
    this.humanoid = rig.humanoid;
    const b = this.bones;
    // 정면 자동 판정: 왼손(왼팔)이 +X 쪽에 있어야 +Z를 바라보는 것
    if (this.humanoid && !this.vrm && !this.tpl.fixedScale) {
      const l = this._modelPos(b.lHand || b.lLower), r = this._modelPos(b.rHand || b.rLower);
      if (l.x < r.x) this.inner.rotation.y += Math.PI;
    }
    if (custom?.flip) this.inner.rotation.y += Math.PI;
    this.root.updateMatrixWorld(true);
    // 발이 바닥(y=0)에 오도록, 가로 중심을 원점에
    if (!this.tpl.fixedScale) {
      const box = boxOf(this.object);
      const c = box.getCenter(new THREE.Vector3());
      this.inner.position.set(-c.x, -box.min.y, -c.z);
      this.root.updateMatrixWorld(true);
    }
    this.baseOffset = this.inner.position.clone();

    // 리셋용 기본 자세 (모든 뼈 + 인식된 리그 노드의 로컬 변환)
    const nodes = new Set();
    this.object.traverse((o) => { if (o.isBone) nodes.add(o); });
    for (const n of Object.values(b)) nodes.add(n);
    this.restNodes = [...nodes].map((n) => ({ n, p: n.position.clone(), q: n.quaternion.clone() }));

    // 팔다리 기본 방향/회전 (모델 공간)
    this.rest = {};
    for (const [a, c, d] of LIMBS) {
      if (b[a] && b[c]) this.rest[a] = { q: this._modelQuat(b[a]), d: this._modelPos(b[c]).sub(this._modelPos(b[a])).normalize() };
      const end = b[d] || b[c]?.children.find((x) => x.isBone || x.children.length);
      if (b[c] && end && end !== b[c]) this.rest[c] = { q: this._modelQuat(b[c]), d: this._modelPos(end).sub(this._modelPos(b[c])).normalize() };
    }

    const top = boxOf(this.inner).max.y;
    this.topY = top;
    this._hip = b.lThigh && b.rThigh ? this._modelPos(b.lThigh).add(this._modelPos(b.rThigh)).multiplyScalar(0.5).y
      : b.hips ? this._modelPos(b.hips).y : top * (this.humanoid ? 0.5 : 0.3);
    this._head = b.head ? this._modelPos(b.head).y : top * 0.9;
    // MMD: VPD 포즈용 이름 사전과 IK
    if (this.kind === 'mmd' && this.object.isSkinnedMesh) {
      this.byName = {};
      this.object.skeleton.bones.forEach((x) => (this.byName[x.name] = x));
      const iks = this.tpl.iks || this.object.geometry.userData.MMD?.iks || [];
      this.ik = iks.length ? new CCDIKSolver(this.object, iks) : null;
    }
  }

  // ---------------------------------------------------------------- 표정
  _setupFace() {
    this.faceMorphs = { blink: [], happy: [], angry: [], sad: [] };
    this.instMorphs = [];
    this.object.traverse((o) => {
      const d = o.morphTargetDictionary;
      if (!d || !o.morphTargetInfluences) return;
      for (const [k, names] of Object.entries(FACE_MORPHS)) {
        const n = names.find((x) => d[x] != null);
        if (n) this.faceMorphs[k].push([o, d[n]]);
      }
      for (const n of INSTRUMENT_MORPHS) if (d[n] != null) { o.morphTargetInfluences[d[n]] = 1; this.instMorphs.push([o, d[n], n]); }
    });
    // 오리지널 아바타: 얼굴 텍스처 교체
    if (this.tpl.faceStates && this.tpl.faceMatIndex >= 0 && Array.isArray(this.object.material)) {
      this.object.material = this.object.material.slice();
      this.faceMat = this.object.material[this.tpl.faceMatIndex].clone();
      this.object.material[this.tpl.faceMatIndex] = this.faceMat;
      this.faceState = 'open';
    }
  }

  _setupMixer(clips) {
    if (this.humanoid || !clips.length) return;
    // 뼈 구조를 인식 못 한 모델은 내장 애니메이션을 재생
    this.mixer = new THREE.AnimationMixer(this.object);
    const find = (re) => clips.find((c) => re.test(c.name));
    this.clips = {
      idle: find(/idle|stand|wait|breath/i) || clips[0],
      walk: find(/walk/i),
      run: find(/run|sprint/i),
      sit: find(/sit/i),
      dance: find(/dance|wave|jump|yes/i),
    };
    this._playClip('idle');
  }
  _playClip(name) {
    const clip = this.clips[name] || this.clips.idle;
    if (!clip || this._clip === clip) return;
    const a = this.mixer.clipAction(clip);
    a.reset().fadeIn(0.25).play();
    if (this._action) this._action.fadeOut(0.25);
    this._action = a;
    this._clip = clip;
  }

  // ---------------------------------------------------------------- 닉네임표 & 말풍선
  get tagY() { return Math.max(1.0, this.topY + 0.18); }
  _makeNameTag(nick) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 96;
    const g = c.getContext('2d');
    g.font = 'bold 54px "Malgun Gothic", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 10;
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.strokeText(nick, 256, 50);
    g.fillStyle = CHAR_INFO[this.char]?.color || '#fff';
    g.fillText(nick, 256, 50);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
    this.tag.scale.set(1.0, 0.1875, 1);
    this.tag.position.y = this.tagY;
    this.tag.renderOrder = 10;
    this.root.add(this.tag);
  }

  say(text) {
    if (this.bubble) { this.root.remove(this.bubble); this.bubble.material.map.dispose(); this.bubble.material.dispose(); }
    const lines = wrapText(text, 18).slice(0, 4);
    const c = document.createElement('canvas');
    const lh = 44;
    c.width = 512; c.height = 40 + lines.length * lh;
    const g = c.getContext('2d');
    g.font = '34px "Malgun Gothic", sans-serif';
    const w = Math.min(500, Math.max(...lines.map((l) => g.measureText(l).width)) + 44);
    const x0 = (512 - w) / 2;
    g.fillStyle = 'rgba(255,255,255,0.94)';
    roundRect(g, x0, 4, w, c.height - 22, 18);
    g.fill();
    g.beginPath(); g.moveTo(240, c.height - 19); g.lineTo(256, c.height - 2); g.lineTo(272, c.height - 19); g.fill();
    g.fillStyle = '#111';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((l, i) => g.fillText(l, 256, 26 + i * lh));
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
    this.bubble.scale.set(1.5, 1.5 * c.height / 512, 1);
    this.bubble.center.set(0.5, 0);
    this.bubble.position.y = this.tagY + 0.12;
    this.bubble.renderOrder = 11;
    this.bubbleT = 6 + text.length * 0.05;
    this.root.add(this.bubble);
  }

  // ---------------------------------------------------------------- 상태
  setEmote(id) {
    this.emote = id || null;
    this.emoteT = 0;
    this.vpd = null;
    const e = EMOTES.find((x) => x.id === id);
    if (e?.vpd && this.kind === 'mmd') {
      this.factory.loadPose(e.vpd).then((vpd) => { if (this.emote === id) this.vpd = vpd; });
    }
  }

  setStick(s) {
    this.stick = { ...this.stick, ...s };
    if (this.stick.on && !this.stickObj) this.stickObj = createLightstick();
    if (this.stickObj) {
      if (!this.stickObj.parent && this.root.parent) this.root.parent.add(this.stickObj);
      this.stickObj.visible = this.stick.on && this.root.visible;
      this.stickObj.userData.setColor(this.stick.colorHex || '#ff69b4');
    }
  }

  dispose() {
    this.root.parent?.remove(this.root);
    this.stickObj?.parent?.remove(this.stickObj);
    this.tag?.material.map.dispose();
    this.bubble?.material.map.dispose();
  }

  get hipHeight() { return this._hip; }
  get headHeight() { return this._head; }

  // ---------------------------------------------------------------- 애니메이션
  update(dt, cheap = false) {
    this.time += dt;
    if (this.stickObj && !this.stickObj.parent && this.root.parent) this.root.parent.add(this.stickObj);
    if (this.bubble) {
      this.bubbleT -= dt;
      if (this.bubbleT < 0.6) this.bubble.material.opacity = Math.max(0, this.bubbleT / 0.6);
      if (this.bubbleT <= 0) { this.root.remove(this.bubble); this.bubble.material.map.dispose(); this.bubble = null; }
    }
    this._acc = (this._acc || 0) + dt;
    if (cheap && this._acc < 0.1) { this._placeStick(); return; }
    const adt = this._acc;
    this._acc = 0;
    this.emoteT += adt;

    const sitting = this.anim === ANIM.sit;
    const moving = this.anim === ANIM.walk || this.anim === ANIM.run;
    this.inner.position.copy(this.baseOffset);

    // 뼈 인식이 안 된 모델: 내장 애니메이션 또는 통통 튀기
    if (!this.humanoid) {
      this.inner.rotation.z = 0;
      if (this.mixer) {
        this._playClip(sitting ? 'sit' : this.anim === ANIM.run ? 'run' : moving ? 'walk' : this.emote ? 'dance' : 'idle');
        this.mixer.update(adt);
      } else if (moving) {
        this.phase += adt * 9;
        this.inner.position.y += Math.abs(Math.sin(this.phase)) * 0.06;
        this.inner.rotation.z = Math.sin(this.phase) * 0.06;
      } else if (this.emote) {
        this.inner.position.y += Math.abs(Math.sin(this.emoteT * 5)) * 0.15;
      }
      this._face(adt, null);
      this.vrm?.update(adt);
      this._placeStick();
      return;
    }

    this._resetPose();
    // MMD VPD 포즈
    if (this.emote && this.vpd && !sitting && !moving && this.byName) {
      this._applyVpd(this.vpd);
      this._instrumentVisible(true);
      this._face(adt, 'happy');
      this._placeStick();
      return;
    }
    this._instrumentVisible(false);

    const P = {
      lArm: V(0.28, -1, 0.04), rArm: V(-0.28, -1, 0.04), lFore: V(0.18, -1, 0.18), rFore: V(-0.18, -1, 0.18),
      lThigh: V(0, -1, 0), rThigh: V(0, -1, 0), lShin: V(0, -1, -0.02), rShin: V(0, -1, -0.02),
      spine: 0, spineZ: 0, head: 0, headY: 0, centerY: 0, yaw: 0,
    };
    let face = null;
    const t = this.time;
    const breath = Math.sin(t * 2.1) * 0.015;
    P.spine = breath;

    if (sitting) {
      P.lThigh = V(0.08, -0.05, 1); P.rThigh = V(-0.08, -0.05, 1);
      P.lShin = V(0.05, -1, 0.12); P.rShin = V(-0.05, -1, 0.12);
      P.lArm = V(0.35, -1, 0.45); P.rArm = V(-0.35, -1, 0.45);
      P.lFore = V(0.05, -0.15, 1); P.rFore = V(-0.05, -0.15, 1);
      P.spine = -0.12 + breath;
    } else if (moving) {
      const run = this.anim === ANIM.run;
      const amp = run ? 0.75 : 0.45;
      this.phase += adt * (run ? 11 : 7.5) * Math.max(0.6, Math.min(1.3, this.speed / (run ? 4.5 : 2.2)));
      const s = Math.sin(this.phase);
      const c = Math.cos(this.phase);
      P.lThigh = V(0, -Math.cos(s * amp), Math.sin(s * amp));
      P.rThigh = V(0, -Math.cos(-s * amp), Math.sin(-s * amp));
      const kneeL = Math.max(0, -c) * (run ? 1.3 : 0.8) + 0.05;
      const kneeR = Math.max(0, c) * (run ? 1.3 : 0.8) + 0.05;
      P.lShin = V(0, -Math.cos(s * amp - kneeL), Math.sin(s * amp - kneeL));
      P.rShin = V(0, -Math.cos(-s * amp - kneeR), Math.sin(-s * amp - kneeR));
      const aa = run ? 0.7 : 0.35;
      P.lArm = V(0.3, -Math.cos(-s * aa), Math.sin(-s * aa));
      P.rArm = V(-0.3, -Math.cos(s * aa), Math.sin(s * aa));
      P.lFore = V(0.15, -Math.cos(-s * aa + (run ? 1.2 : 0.4)), Math.sin(-s * aa + (run ? 1.2 : 0.4)));
      P.rFore = V(-0.15, -Math.cos(s * aa + (run ? 1.2 : 0.4)), Math.sin(s * aa + (run ? 1.2 : 0.4)));
      P.centerY = -Math.abs(c) * (run ? 0.45 : 0.25);
      P.spine = run ? 0.18 : 0.04;
    } else if (this.anim === ANIM.air) {
      P.lThigh = V(0, -1, 0.5); P.rThigh = V(0, -1, -0.2);
      P.lShin = V(0, -1, -0.4); P.rShin = V(0, -1, -0.6);
      P.lArm = V(1, -0.2, 0.2); P.rArm = V(-1, -0.2, 0.2);
    }

    if (this.emote && !moving) {
      const e = this.emote;
      const et = this.emoteT;
      if (e === 'wave') {
        P.rArm = V(-0.7, 0.55, 0.25);
        P.rFore = V(-0.15 + Math.sin(et * 9) * 0.55, 1, 0.1);
        face = 'happy';
      } else if (e === 'clap') {
        const k = (Math.sin(et * 13) + 1) / 2;
        P.lArm = V(0.3, -0.6, 0.75); P.rArm = V(-0.3, -0.6, 0.75);
        P.lFore = V(-0.25 - k * 0.5, 0.15, 1); P.rFore = V(0.25 + k * 0.5, 0.15, 1);
        face = 'happy';
      } else if (e === 'banzai') {
        const k = Math.abs(Math.sin(et * 4));
        P.lArm = V(0.35, 1, 0.1 * k); P.rArm = V(-0.35, 1, 0.1 * k);
        P.lFore = V(0.2, 1, 0); P.rFore = V(-0.2, 1, 0);
        if (!sitting) P.centerY = k * 0.6;
        face = 'happy';
      } else if (e === 'bow') {
        const k = Math.min(1, et * 2) * (et > 2.2 ? Math.max(0, 1 - (et - 2.2) * 2) : 1);
        P.spine = 0.8 * k; P.head = 0.3 * k;
        P.lArm = V(0.1, -1, 0.35 * k); P.rArm = V(-0.1, -1, 0.35 * k);
        P.lFore = V(-0.4, -1, 0.3); P.rFore = V(0.4, -1, 0.3);
      } else if (e === 'dance') {
        const s = Math.sin(et * 5);
        P.spineZ = s * 0.18; P.yaw = s * 0.25; P.centerY = -Math.abs(Math.cos(et * 5)) * 0.4;
        P.lArm = V(0.8, 0.3 + s * 0.5, 0.3); P.rArm = V(-0.8, 0.3 - s * 0.5, 0.3);
        P.lFore = V(0.3, 1, 0.2); P.rFore = V(-0.3, 1, 0.2);
        face = 'happy';
      } else if (e === 'fight') {
        const k = Math.abs(Math.sin(et * 6));
        P.rArm = V(-0.5, 0.2 + k * 0.6, 0.6); P.rFore = V(0, 1, 0.3);
        P.lArm = V(0.4, -0.6, 0.6); P.lFore = V(-0.2, 0.6, 1);
        face = 'angry';
      } else if (e === 'think') {
        P.rArm = V(-0.3, -1, 0.6); P.rFore = V(0.4, 1, 0.5);
        P.lArm = V(0.2, -1, 0.5); P.lFore = V(-0.8, 0.1, 0.7);
        P.head = 0.15; P.headY = 0.2;
        face = 'sad';
      } else if (e === 'airguitar') {
        const k = Math.sin(et * 12);
        P.lArm = V(0.85, -0.25, 0.45); P.lFore = V(0.55, 0.15, 0.8);
        P.rArm = V(-0.45, -0.75, 0.45); P.rFore = V(0.55, -0.35 + k * 0.35, 0.75);
        P.head = Math.abs(Math.sin(et * 6)) * 0.25; P.spine = 0.08;
        face = 'happy';
      } else if (e === 'drum') {
        const k = Math.sin(et * 14);
        P.lArm = V(0.45, -0.7, 0.55); P.rArm = V(-0.45, -0.7, 0.55);
        P.lFore = V(0.1, -0.2 + k * 0.45, 1); P.rFore = V(-0.1, -0.2 - k * 0.45, 1);
        P.head = Math.abs(Math.sin(et * 7)) * 0.2;
        face = 'happy';
      }
    }

    if (this.stick.on && !(this.emote && ['wave', 'clap', 'banzai', 'fight', 'think', 'airguitar', 'drum'].includes(this.emote))) {
      if (this.stick.wave) {
        const s = Math.sin(t * 7.5);
        P.rArm = V(-0.35, 0.45, 0.55);
        P.rFore = V(s * 0.75, 1, 0.25);
        face = face || 'happy';
      } else if (!moving || this.anim === ANIM.walk) {
        P.rArm = V(-0.5, -0.85, 0.3);
        P.rFore = V(-0.35, 0.35, 1);
      }
    }

    this._applyPose(P);
    this._face(adt, face);
    this.vrm?.update(adt);
    this._placeStick();
  }

  _resetPose() {
    for (const r of this.restNodes) { r.n.position.copy(r.p); r.n.quaternion.copy(r.q); }
    this.inner.rotation.z = 0;
  }

  // 모델 공간 회전 R을 갖도록 노드의 로컬 회전 설정
  _setModelQuat(node, R) {
    const parentQ = this._modelQuat(node.parent, _q2);
    node.quaternion.copy(parentQ.invert().multiply(R));
    node.updateMatrixWorld(true);
  }

  _applyPose(P) {
    const b = this.bones;
    this.root.updateMatrixWorld(true);
    // 몸통/머리: 모델 공간 기준 기울기
    const spine = b.spine || b.chest;
    if (spine && (P.spine || P.yaw || P.spineZ)) {
      const R = new THREE.Quaternion().setFromEuler(_e.set(P.spine, P.yaw, P.spineZ)).multiply(this._modelQuat(spine));
      this._setModelQuat(spine, R);
    }
    if (b.head && (P.head || P.headY)) {
      const R = new THREE.Quaternion().setFromEuler(_e.set(P.head, P.headY, 0)).multiply(this._modelQuat(b.head));
      this._setModelQuat(b.head, R);
    }
    // 팔다리 조준
    for (const [pk, rk] of AIM) {
      const node = b[rk];
      const rest = this.rest[rk];
      if (!node || !rest || !P[pk]) continue;
      const R = new THREE.Quaternion().setFromUnitVectors(rest.d, P[pk]).multiply(rest.q);
      this._setModelQuat(node, R);
    }
    // 무게중심 상하 (MMD 단위 → 미터, 키에 비례)
    this.inner.position.y += P.centerY * SCALE * (this.topY / 1.6);
  }

  _applyVpd(vpd) {
    const center = vpd.bones.find((x) => x.name === 'センター');
    if (center) this.inner.position.add(_v.set(-center.translation[0], 0, -center.translation[2]).multiplyScalar(this.inner.scale.x));
    for (const bp of vpd.bones) {
      const bone = this.byName[bp.name];
      if (!bone) continue;
      bone.position.add(_v.fromArray(bp.translation));
      bone.quaternion.multiply(_q.fromArray(bp.quaternion));
    }
    this.object.updateMatrixWorld(true);
    this.ik?.update();
    this.object.updateMatrixWorld(true);
  }

  _instrumentVisible(on) {
    if (this._instOn === on) return;
    this._instOn = on;
    for (const [o, i, n] of this.instMorphs) if (n !== '猫みみ縮小') o.morphTargetInfluences[i] = on ? 0 : 1;
  }

  _face(dt, expr) {
    this.blinkT -= dt;
    let blink = 0;
    if (this.blinkT < 0.15) blink = 1 - Math.abs(this.blinkT / 0.075 - 1);
    if (this.blinkT < 0) this.blinkT = 2.5 + Math.random() * 3.5;
    if (expr === 'happy') blink = 0;
    blink = Math.max(0, Math.min(1, blink));
    if (this.vrm?.expressionManager) {
      const em = this.vrm.expressionManager;
      em.setValue('blink', blink);
      for (const k of ['happy', 'angry', 'sad']) em.setValue(k, k === expr ? 0.85 : 0);
    }
    for (const [k, list] of Object.entries(this.faceMorphs)) {
      const v = k === 'blink' ? blink : k === expr ? 0.8 : 0;
      for (const [o, i] of list) o.morphTargetInfluences[i] = v;
    }
    if (this.faceMat) {
      const st = blink > 0.5 ? 'closed' : expr === 'happy' ? 'smile' : expr === 'angry' ? 'angry' : expr === 'sad' ? 'trouble' : 'open';
      if (st !== this.faceState) { this.faceState = st; this.faceMat.map = this.tpl.faceStates[st]; }
    }
  }

  _placeStick() {
    if (!this.stickObj) return;
    const vis = this.stick.on && this.root.visible;
    this.stickObj.visible = vis;
    if (!vis) return;
    const wrist = this.bones.rHand || this.bones.rLower;
    const elbow = this.bones.rLower || this.bones.rUpper;
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(this.root.quaternion);
    if (!this.humanoid || !wrist || !elbow || wrist === elbow) {
      // 뼈가 없는 모델: 몸 오른쪽에 들고 있는 것처럼
      const s = Math.sin(this.time * 7.5) * (this.stick.wave ? 0.6 : 0);
      this.stickObj.position.copy(this.root.position).addScaledVector(right, 0.35).add(_v.set(0, this.topY * 0.55, 0));
      this.stickObj.quaternion.setFromUnitVectors(up, _v2.copy(up).addScaledVector(right, s).normalize());
      return;
    }
    const wp = wrist.getWorldPosition(_v);
    const ep = elbow.getWorldPosition(_v2);
    const fore = wp.clone().sub(ep).normalize();
    const hand = wp.clone().addScaledVector(fore, 0.06);
    const axis = fore.clone().multiplyScalar(0.25).add(up).addScaledVector(right, 0.35).normalize();
    if (this.stick.wave) axis.copy(fore).multiplyScalar(0.8).add(up.clone().multiplyScalar(0.6)).normalize();
    this.stickObj.position.copy(hand);
    this.stickObj.quaternion.setFromUnitVectors(up, axis);
  }
}

// 스킨 메시는 뼈 변환까지 반영한 실제 모양으로 크기를 잰다 (바인드 자세와 다른 모델 대응)
function boxOf(obj) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3();
  obj.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    if (o.isSkinnedMesh) {
      const pos = o.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 4000)); // 큰 모델은 표본만
      for (let i = 0; i < pos.count; i += step) {
        o.getVertexPosition(i, _v);
        box.expandByPoint(_v.applyMatrix4(o.matrixWorld));
      }
    } else box.expandByObject(o, false);
  });
  if (box.isEmpty()) box.setFromObject(obj, false);
  return box;
}

function wrapText(text, n) {
  const out = [];
  let line = '';
  for (const w of text.split(/(\s+)/)) {
    if ((line + w).length > n && line) { out.push(line.trim()); line = ''; }
    if (w.length > n) { for (let i = 0; i < w.length; i += n) out.push(w.slice(i, i + n)); continue; }
    line += w;
  }
  if (line.trim()) out.push(line.trim());
  return out.length ? out : [''];
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
