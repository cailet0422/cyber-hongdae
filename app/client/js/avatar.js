// 케이온 PMD 아바타: 로딩/복제, 절차 애니메이션(걷기·착석·이모트), VPD 포즈, 응원봉, 닉네임/말풍선
import * as THREE from 'three';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';
import { CCDIKSolver } from 'three/addons/animation/CCDIKSolver.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { createLightstick } from './lightstick.js';
import { buildProceduralBase } from './procedural-avatar.js';

export const SCALE = 0.08; // MMD 1단위 ≈ 8cm
export const CHAR_INFO = {
  yui: { name: '유이', inst: '기타', color: '#ff7eb6' },
  mio: { name: '미오', inst: '베이스', color: '#4d7cff' },
  ritsu: { name: '리츠', inst: '드럼', color: '#ffd23f' },
  mugi: { name: '무기', inst: '키보드', color: '#b9f2ff' },
  azusa: { name: '아즈사', inst: '기타', color: '#ff4040' },
};
const INSTRUMENT_MORPHS = ['ギター縮小', 'ベース縮小', '鍵盤縮小', '右棒縮小', '左棒縮小', '猫みみ縮小'];

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
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class AvatarFactory {
  constructor() {
    const manager = new THREE.LoadingManager();
    // PMD 안의 .tga 텍스처를 변환해 둔 .webp로 받는다
    manager.setURLModifier((url) => url.replace(/\.tga$/i, '.webp'));
    manager.addHandler(/\.tga$/i, new THREE.TextureLoader(manager));
    this.loader = new MMDLoader(manager);
    this.cache = new Map();
    this.poses = new Map();
    // 서버가 알려주는 설치된 모델 팩 목록 (/api/info → assets). 없으면 오리지널 아바타 사용
    this.assets = { models: [], poses: [] };
    this.assetsReady = new Promise((res) => (this._setAssets = res));
  }

  setAssets(a) { this.assets = { models: a?.models || [], poses: a?.poses || [] }; this._setAssets(); }
  hasPose(id) { return this.assets.poses.includes(id); }

  loadModel(char) {
    if (!this.cache.has(char)) {
      this.cache.set(char, this.assetsReady.then(() => new Promise((res) => {
        const procedural = () => {
          const b = buildProceduralBase(char);
          res(Object.assign(prepareBase(b.mesh), { faceStates: b.faceStates, faceMatIndex: b.faceMatIndex, procedural: true }));
        };
        if (!this.assets.models.includes(char)) return procedural();
        this.loader.load(`/assets/models/${char}/model.pmd`, (mesh) => res(prepareBase(mesh)), undefined, procedural);
      })));
    }
    return this.cache.get(char);
  }

  loadPose(id) {
    if (!this.hasPose(id)) return Promise.resolve(null);
    if (!this.poses.has(id)) {
      this.poses.set(id, new Promise((res) => this.loader.loadVPD(`/assets/poses/${id}.vpd`, false, res, undefined, () => res(null))));
    }
    return this.poses.get(id);
  }

  async create(char, opts) {
    const base = await this.loadModel(char);
    return new Avatar(this, base, char, opts);
  }
}

function prepareBase(mesh) {
  mesh.geometry.computeBoundingSphere();
  const bones = mesh.skeleton.bones;
  const rest = bones.map((b) => ({ p: b.position.clone(), q: b.quaternion.clone() }));
  const byName = {};
  bones.forEach((b, i) => (byName[b.name] = i));
  // 모델 공간 기준 뼈 위치 (부모 체인 누적)
  const world = bones.map(() => new THREE.Vector3());
  bones.forEach((b, i) => {
    const pi = b.parent && b.parent.isBone ? bones.indexOf(b.parent) : -1;
    world[i].copy(b.position);
    if (pi >= 0) world[i].add(world[pi]);
  });
  const dirOf = (a, c) => (byName[a] != null && byName[c] != null ? world[byName[c]].clone().sub(world[byName[a]]).normalize() : null);
  const segs = {
    lArm: ['左腕', '左ひじ'], lFore: ['左ひじ', '左手首'], rArm: ['右腕', '右ひじ'], rFore: ['右ひじ', '右手首'],
    lThigh: ['左足', '左ひざ'], lShin: ['左ひざ', '左足首'], rThigh: ['右足', '右ひざ'], rShin: ['右ひざ', '右足首'],
  };
  const restDir = {};
  for (const [k, [a, c]] of Object.entries(segs)) restDir[k] = dirOf(a, c);
  const hipY = byName['右足'] != null ? world[byName['右足']].y : 10;
  const headY = byName['頭'] != null ? world[byName['頭']].y : 17;
  const md = mesh.morphTargetDictionary || {};
  return { mesh, rest, byName, world, restDir, segs, hipY, headY, md, iks: mesh.geometry.userData.MMD?.iks || [] };
}

export class Avatar {
  constructor(factory, base, char, { nick = '', isLocal = false } = {}) {
    this.factory = factory;
    this.base = base;
    this.char = char;
    this.isLocal = isLocal;
    this.root = new THREE.Group();
    this.mesh = SkeletonUtils.clone(base.mesh);
    this.mesh.scale.setScalar(SCALE);
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
    this.bones = this.mesh.skeleton.bones;
    this.ik = base.iks.length ? new CCDIKSolver(this.mesh, base.iks) : null;
    this.morph = this.mesh.morphTargetInfluences || [];
    for (const n of INSTRUMENT_MORPHS) this._setMorph(n, 1);
    // 오리지널 아바타: 표정은 얼굴 텍스처 교체 (아바타마다 얼굴 머티리얼 복제)
    if (base.faceStates && base.faceMatIndex >= 0) {
      this.mesh.material = this.mesh.material.slice();
      this.faceMat = this.mesh.material[base.faceMatIndex].clone();
      this.mesh.material[base.faceMatIndex] = this.faceMat;
      this.faceState = 'open';
    }

    this.anim = ANIM.idle;
    this.speed = 0;
    this.phase = 0;
    this.time = Math.random() * 10;
    this.emote = null;
    this.emoteT = 0;
    this.emoteW = 0;
    this.vpd = null;
    this.blinkT = 2 + Math.random() * 3;
    this.stick = { on: false, color: 0, wave: false };
    this.stickObj = null;
    this.nick = nick;
    this.visibleWanted = true;
    if (nick) this._makeNameTag(nick);
  }

  bone(name) { const i = this.base.byName[name]; return i == null ? null : this.bones[i]; }
  _setMorph(name, v) { const i = this.base.md[name]; if (i != null) this.morph[i] = v; }

  // ---------------------------------------------------------------- 닉네임표 & 말풍선
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
    this.tagCanvas = c;
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
    this.tag.scale.set(1.0, 0.1875, 1);
    this.tag.position.y = 1.85;
    this.tag.renderOrder = 10;
    this.root.add(this.tag);
  }
  setTagColor() {
    if (!this.tag) return;
    this.root.remove(this.tag);
    this.tag.material.map.dispose();
    this._makeNameTag(this.nick);
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
    this.bubble.position.y = 1.97;
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
    if (e?.vpd) {
      this.factory.loadPose(e.vpd).then((vpd) => { if (this.emote === id) this.vpd = vpd; });
    }
  }

  setStick(s) {
    this.stick = { ...this.stick, ...s };
    if (this.stick.on && !this.stickObj) {
      this.stickObj = createLightstick();
      this.root.parent?.add(this.stickObj);
    }
    if (this.stickObj) {
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

  // ---------------------------------------------------------------- 애니메이션
  update(dt, cheap = false) {
    this.time += dt;
    if (this.bubble) {
      this.bubbleT -= dt;
      if (this.bubbleT < 0.6) this.bubble.material.opacity = Math.max(0, this.bubbleT / 0.6);
      if (this.bubbleT <= 0) { this.root.remove(this.bubble); this.bubble.material.map.dispose(); this.bubble = null; }
    }
    // 먼 아바타는 프레임을 건너뛰며 갱신
    this._acc = (this._acc || 0) + dt;
    if (cheap && this._acc < 0.1) { this._placeStick(); return; }
    const adt = this._acc;
    this._acc = 0;

    this._resetPose();
    const b = this.base;
    const t = this.time;
    const sitting = this.anim === ANIM.sit;
    const moving = this.anim === ANIM.walk || this.anim === ANIM.run;
    if (moving) this.emote = this.emote && !this.isLocal ? this.emote : this.emote; // 원격 이모트는 상태 유지
    this.emoteT += adt;

    // VPD 포즈 이모트
    if (this.emote && this.vpd && !sitting && !moving) {
      this._applyVpd(this.vpd);
      this._instrumentVisible(true);
      this._face(adt, 'にこ');
      this._placeStick();
      return;
    }
    this._instrumentVisible(false);

    const P = {
      lArm: V(0.28, -1, 0.04), rArm: V(-0.28, -1, 0.04), lFore: V(0.18, -1, 0.18), rFore: V(-0.18, -1, 0.18),
      lThigh: V(0, -1, 0), rThigh: V(0, -1, 0), lShin: V(0, -1, -0.02), rShin: V(0, -1, -0.02),
      spine: 0, spineZ: 0, head: 0, headY: 0, centerY: 0, centerZ: 0, yaw: 0,
    };
    let face = null;
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

    // 절차 이모트 (서 있거나 앉아서)
    if (this.emote && !moving) {
      const e = this.emote;
      const et = this.emoteT;
      if (e === 'wave') {
        P.rArm = V(-0.7, 0.55, 0.25);
        P.rFore = V(-0.15 + Math.sin(et * 9) * 0.55, 1, 0.1);
        face = '笑い';
      } else if (e === 'clap') {
        const k = (Math.sin(et * 13) + 1) / 2;
        P.lArm = V(0.3, -0.6, 0.75); P.rArm = V(-0.3, -0.6, 0.75);
        P.lFore = V(-0.25 - k * 0.5, 0.15, 1); P.rFore = V(0.25 + k * 0.5, 0.15, 1);
        face = '笑い';
      } else if (e === 'banzai') {
        const k = Math.abs(Math.sin(et * 4));
        P.lArm = V(0.35, 1, 0.1 * k); P.rArm = V(-0.35, 1, 0.1 * k);
        P.lFore = V(0.2, 1, 0); P.rFore = V(-0.2, 1, 0);
        if (!sitting) P.centerY = k * 0.6;
        face = '笑い';
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
        face = 'にこ';
      } else if (e === 'fight') {
        const k = Math.abs(Math.sin(et * 6));
        P.rArm = V(-0.5, 0.2 + k * 0.6, 0.6); P.rFore = V(0, 1, 0.3);
        P.lArm = V(0.4, -0.6, 0.6); P.lFore = V(-0.2, 0.6, 1);
        face = '怒る';
      } else if (e === 'airguitar') {
        const k = Math.sin(et * 12);
        P.lArm = V(0.85, -0.25, 0.45); P.lFore = V(0.55, 0.15, 0.8);
        P.rArm = V(-0.45, -0.75, 0.45); P.rFore = V(0.55, -0.35 + k * 0.35, 0.75);
        P.head = Math.abs(Math.sin(et * 6)) * 0.25; P.spine = 0.08;
        face = '笑い';
      } else if (e === 'drum') {
        const k = Math.sin(et * 14);
        P.lArm = V(0.45, -0.7, 0.55); P.rArm = V(-0.45, -0.7, 0.55);
        P.lFore = V(0.1, -0.2 + k * 0.45, 1); P.rFore = V(-0.1, -0.2 - k * 0.45, 1);
        P.head = Math.abs(Math.sin(et * 7)) * 0.2;
        face = 'にこ';
      } else if (e === 'think') {
        P.rArm = V(-0.3, -1, 0.6); P.rFore = V(0.4, 1, 0.5);
        P.lArm = V(0.2, -1, 0.5); P.lFore = V(-0.8, 0.1, 0.7);
        P.head = 0.15; P.headY = 0.2;
        face = '困る';
      }
    }

    // 응원봉: 오른손으로 들기 / 흔들기
    if (this.stick.on && !(this.emote && ['wave', 'clap', 'banzai', 'fight', 'think'].includes(this.emote))) {
      if (this.stick.wave) {
        const s = Math.sin(t * 7.5);
        P.rArm = V(-0.35, 0.45, 0.55);
        P.rFore = V(s * 0.75, 1, 0.25);
        face = face || '笑い';
      } else if (!moving || this.anim === ANIM.walk) {
        P.rArm = V(-0.5, -0.85, 0.3);
        P.rFore = V(-0.35, 0.35, 1);
      }
    }

    this._aimLimbs(P);
    const sp = this.bone('上半身');
    if (sp) sp.quaternion.multiply(_q.setFromEuler(new THREE.Euler(P.spine, P.yaw, P.spineZ)));
    const hd = this.bone('頭');
    if (hd) hd.quaternion.multiply(_q.setFromEuler(new THREE.Euler(P.head, P.headY, 0)));
    const ct = this.bone('センター');
    if (ct) { ct.position.y += P.centerY; ct.position.z += P.centerZ; }
    this._face(adt, face);
    this.mesh.updateMatrixWorld(true);
    this._placeStick();
  }

  _resetPose() {
    this.mesh.position.set(0, 0, 0);
    const rest = this.base.rest;
    for (let i = 0; i < this.bones.length; i++) {
      this.bones[i].position.copy(rest[i].p);
      this.bones[i].quaternion.copy(rest[i].q);
    }
  }

  // 각 팔다리 뼈가 모델 공간의 지정 방향을 향하도록 (부모 회전을 고려)
  _aimLimbs(P) {
    const order = ['lArm', 'lFore', 'rArm', 'rFore', 'lThigh', 'lShin', 'rThigh', 'rShin'];
    for (const k of order) {
      const [bn] = this.base.segs[k];
      const bone = this.bone(bn);
      const rd = this.base.restDir[k];
      if (!bone || !rd || !P[k]) continue;
      // 조상 뼈들의 현재 회전을 루트부터 누적 = 부모의 모델 공간 회전
      _q2.identity();
      const chain = [];
      for (let p = bone.parent; p && p.isBone; p = p.parent) chain.push(p);
      for (let i = chain.length - 1; i >= 0; i--) _q2.multiply(chain[i].quaternion);
      const target = _v.copy(P[k]).applyQuaternion(_q.copy(_q2).invert());
      bone.quaternion.setFromUnitVectors(rd, target);
    }
  }

  _applyVpd(vpd) {
    // 포즈의 센터 수평 이동은 상쇄 (캐릭터가 제자리에서 포즈를 취하도록)
    const center = vpd.bones.find((b) => b.name === 'センター');
    if (center) this.mesh.position.set(-center.translation[0] * SCALE, 0, -center.translation[2] * SCALE);
    for (const bp of vpd.bones) {
      const i = this.base.byName[bp.name];
      if (i == null) continue;
      const b = this.bones[i];
      b.position.add(_v.fromArray(bp.translation));
      b.quaternion.multiply(_q.fromArray(bp.quaternion));
    }
    this.mesh.updateMatrixWorld(true);
    this.ik?.update();
    this.mesh.updateMatrixWorld(true);
  }

  _instrumentVisible(on) {
    if (this._instOn === on) return;
    this._instOn = on;
    for (const n of INSTRUMENT_MORPHS) if (n !== '猫みみ縮小') this._setMorph(n, on ? 0 : 1);
  }

  _face(dt, expr) {
    for (const n of ['笑い', 'にこ', '怒る', '困る']) this._setMorph(n, n === expr ? 0.8 : 0);
    this.blinkT -= dt;
    let blink = 0;
    if (this.blinkT < 0.15) blink = 1 - Math.abs(this.blinkT / 0.075 - 1);
    if (this.blinkT < 0) this.blinkT = 2.5 + Math.random() * 3.5;
    if (expr === '笑い') blink = 0;
    this._setMorph('まばたき', Math.max(0, Math.min(1, blink)));
    if (this.faceMat) {
      const st = blink > 0.5 ? 'closed' : expr === '笑い' || expr === 'にこ' ? 'smile' : expr === '怒る' ? 'angry' : expr === '困る' ? 'trouble' : 'open';
      if (st !== this.faceState) { this.faceState = st; this.faceMat.map = this.base.faceStates[st]; }
    }
  }

  _placeStick() {
    if (!this.stickObj) return;
    const vis = this.stick.on && this.root.visible;
    this.stickObj.visible = vis;
    if (!vis) return;
    const wrist = this.bone('右手首');
    const elbow = this.bone('右ひじ');
    if (!wrist || !elbow) return;
    const wp = wrist.getWorldPosition(_v);
    const ep = elbow.getWorldPosition(_v2);
    const fore = ep.sub(wp).negate().normalize(); // 팔꿈치 → 손목
    const hand = wp.clone().addScaledVector(fore, 0.06);
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(this.root.quaternion);
    const axis = fore.clone().multiplyScalar(0.25).add(up).addScaledVector(right, 0.35).normalize();
    if (this.stick.wave) axis.copy(fore).multiplyScalar(0.8).add(up.multiplyScalar(0.6)).normalize();
    this.stickObj.position.copy(hand);
    this.stickObj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
  }

  // 아바타 루트의 바닥 기준 착석 높이 보정값 (힙 관절 높이, m)
  get hipHeight() { return this.base.hipY * SCALE; }
  get headHeight() { return this.base.headY * SCALE; }
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
