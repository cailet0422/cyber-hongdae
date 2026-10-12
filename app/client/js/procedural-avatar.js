// 오리지널(클린룸) 툰 아바타 생성기
// 외부 모델 데이터를 전혀 쓰지 않고 코드로 스켈레톤과 메시를 만든다. 뼈 이름은 MMD 규격을 따라
// 걷기/착석/이모트/응원봉 애니메이션을 PMD 모델과 똑같이 쓸 수 있다.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const U = 12.5; // m → MMD 단위 (아바타가 0.08배로 축소해서 표시)

// 캐릭터별 디자인 (머리 모양·색은 일반적인 묘사만 사용)
const STYLES = {
  yui: { hair: '#6b4228', hairStyle: 'bob', eye: '#7a5432', ribbon: '#e8333a', legs: 'skin', socks: '#2a2e45', pins: '#ffd23f' },
  mio: { hair: '#17171f', hairStyle: 'long', eye: '#3a3a55', ribbon: '#3f6fe8', legs: 'tights' },
  ritsu: { hair: '#b67838', hairStyle: 'short', eye: '#a8732f', ribbon: '#f0b020', legs: 'skin', socks: '#f2f2f2', band: '#ffd23f' },
  mugi: { hair: '#efdc9c', hairStyle: 'wavy', eye: '#4c7cc0', ribbon: '#ff6fae', legs: 'skin', socks: '#2a2e45', brows: true },
  azusa: { hair: '#121217', hairStyle: 'twin', eye: '#6a3422', ribbon: '#2fc45e', legs: 'tights', tieRibbon: '#e02838' },
};
const SKIN = '#ffe2d0';
const BLAZER = '#242838';
const SHIRT = '#f4f4f6';
const SHOE = '#5a3424';
const TIGHTS = '#26262c';

let gradient = null;
function toonGradient() {
  if (gradient) return gradient;
  const data = new Uint8Array([90, 170, 255]);
  gradient = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}
const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color: new THREE.Color(color), gradientMap: toonGradient(), ...extra });

function skirtTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#5b6680'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(30,36,60,0.55)'; g.lineWidth = 10;
  for (let i = 0; i < 128; i += 32) { g.beginPath(); g.moveTo(i + 8, 0); g.lineTo(i + 8, 128); g.stroke(); g.beginPath(); g.moveTo(0, i + 8); g.lineTo(128, i + 8); g.stroke(); }
  g.strokeStyle = 'rgba(220,220,235,0.35)'; g.lineWidth = 2;
  for (let i = 0; i < 128; i += 32) { g.beginPath(); g.moveTo(i + 22, 0); g.lineTo(i + 22, 128); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 1);
  return t;
}

// ------------------------------------------------------------------ 얼굴 텍스처 (표정별)
function faceTexture(style, state) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const eyeY = S * 0.5, eyeDX = S * 0.175, ew = S * 0.12, eh = S * 0.168;
  // 볼터치
  g.fillStyle = 'rgba(255,120,140,0.22)';
  for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(S / 2 + sx * S * 0.24, S * 0.68, S * 0.06, S * 0.03, 0, 0, Math.PI * 2); g.fill(); }
  // 눈썹
  g.strokeStyle = style.hair === '#efdc9c' ? '#b89a50' : '#3a2a22';
  g.lineCap = 'round';
  g.lineWidth = style.brows ? 9 : 4;
  for (const sx of [-1, 1]) {
    g.beginPath();
    const x = S / 2 + sx * eyeDX;
    const tilt = state === 'angry' ? 10 : state === 'trouble' ? -10 : 0;
    g.moveTo(x - sx * 18, S * 0.33 + (state === 'angry' ? -6 : 0) + tilt * 0);
    g.lineTo(x + sx * 18, S * 0.33 + tilt);
    g.stroke();
  }
  // 눈
  for (const sx of [-1, 1]) {
    const x = S / 2 + sx * eyeDX;
    if (state === 'closed') {
      g.strokeStyle = '#2a1a18'; g.lineWidth = 5;
      g.beginPath(); g.arc(x, eyeY - 4, ew * 0.9, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
      continue;
    }
    if (state === 'smile') {
      g.strokeStyle = '#2a1a18'; g.lineWidth = 6;
      g.beginPath(); g.arc(x, eyeY + 8, ew * 0.85, 1.15 * Math.PI, 1.85 * Math.PI); g.stroke();
      continue;
    }
    g.fillStyle = '#ffffff';
    g.beginPath(); g.ellipse(x, eyeY, ew, eh, 0, 0, Math.PI * 2); g.fill();
    const grd = g.createLinearGradient(0, eyeY - eh, 0, eyeY + eh);
    grd.addColorStop(0, '#1a1214'); grd.addColorStop(0.45, style.eye); grd.addColorStop(1, lighten(style.eye, 0.35));
    g.fillStyle = grd;
    g.beginPath(); g.ellipse(x, eyeY + 4, ew * 0.82, eh * 0.86, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#120c0e';
    g.beginPath(); g.ellipse(x, eyeY + 6, ew * 0.38, eh * 0.42, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.beginPath(); g.ellipse(x - sx * ew * 0.25, eyeY - eh * 0.32, ew * 0.26, eh * 0.2, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(x + sx * ew * 0.3, eyeY + eh * 0.35, ew * 0.12, 0, Math.PI * 2); g.fill();
    // 윗속눈썹
    g.strokeStyle = '#1a1012'; g.lineWidth = 7;
    g.beginPath(); g.ellipse(x, eyeY + 4, ew * 1.08, eh * 1.0, 0, 1.12 * Math.PI, 1.88 * Math.PI); g.stroke();
  }
  // 입
  g.strokeStyle = '#a0404a'; g.fillStyle = '#c0505a'; g.lineWidth = 4;
  const my = S * 0.8;
  if (state === 'smile') { g.beginPath(); g.arc(S / 2, my - 8, 16, 0.05 * Math.PI, 0.95 * Math.PI); g.closePath(); g.fill(); }
  else if (state === 'angry') { g.beginPath(); g.moveTo(S / 2 - 12, my + 2); g.lineTo(S / 2 + 12, my - 2); g.stroke(); }
  else if (state === 'trouble') { g.beginPath(); g.arc(S / 2, my + 8, 10, 1.15 * Math.PI, 1.85 * Math.PI); g.stroke(); }
  else { g.beginPath(); g.arc(S / 2, my - 6, 9, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function lighten(hex, k) {
  const c = new THREE.Color(hex);
  return '#' + c.lerp(new THREE.Color('#ffffff'), k).getHexString();
}

// ------------------------------------------------------------------ 스켈레톤
// [이름, 부모, x, y, z] (모델 공간, 미터) — 모델은 +Z를 바라보고 왼쪽이 +X
const BONES = [
  ['センター', null, 0, 0.80, 0],
  ['下半身', 'センター', 0, 0.86, 0],
  ['上半身', 'センター', 0, 0.86, 0],
  ['首', '上半身', 0, 1.26, 0],
  ['頭', '首', 0, 1.32, 0],
  ['左肩', '上半身', 0.03, 1.22, 0], ['左腕', '左肩', 0.14, 1.215, 0], ['左ひじ', '左腕', 0.36, 1.215, 0], ['左手首', '左ひじ', 0.56, 1.215, 0],
  ['右肩', '上半身', -0.03, 1.22, 0], ['右腕', '右肩', -0.14, 1.215, 0], ['右ひじ', '右腕', -0.36, 1.215, 0], ['右手首', '右ひじ', -0.56, 1.215, 0],
  ['左足', '下半身', 0.085, 0.80, 0], ['左ひざ', '左足', 0.085, 0.44, 0], ['左足首', '左ひざ', 0.085, 0.075, 0],
  ['右足', '下半身', -0.085, 0.80, 0], ['右ひざ', '右足', -0.085, 0.44, 0], ['右足首', '右ひざ', -0.085, 0.075, 0],
];

// 두 점을 잇는 원기둥 (반지름 r1→r2)
function limb(a, b, r1, r2 = r1, seg = 12) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const g = new THREE.CylinderGeometry(r2, r1, len, seg, 1, false);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  g.applyQuaternion(q);
  g.translate((va.x + vb.x) / 2, (va.y + vb.y) / 2, (va.z + vb.z) / 2);
  return g;
}
function sphere(c, r, sx = 1, sy = 1, sz = 1, seg = 16) {
  const g = new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75));
  g.scale(sx, sy, sz);
  g.translate(...c);
  return g;
}
function boxG(c, w, h, d, rot = [0, 0, 0]) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateX(rot[0]); g.rotateY(rot[1]); g.rotateZ(rot[2]);
  g.translate(...c);
  return g;
}

export function buildProceduralBase(charId) {
  const st = STYLES[charId] || STYLES.yui;
  const pos = Object.fromEntries(BONES.map(([n, , x, y, z]) => [n, [x, y, z]]));
  const boneIndex = Object.fromEntries(BONES.map(([n], i) => [n, i]));

  // 머티리얼
  const mats = {
    skin: toon(SKIN),
    blazer: toon(BLAZER),
    shirt: toon(SHIRT),
    skirt: toon('#ffffff', { map: skirtTexture() }),
    hair: toon(st.hair),
    accent: toon(st.ribbon),
    legs: toon(st.legs === 'tights' ? TIGHTS : SKIN),
    socks: toon(st.socks || TIGHTS),
    shoe: toon(SHOE),
    deco: toon(st.band || st.pins || st.tieRibbon || st.ribbon),
    face: new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: true, polygonOffset: true, polygonOffsetFactor: -2 }),
  };
  const parts = Object.fromEntries(Object.keys(mats).map((k) => [k, []]));
  const add = (mat, bone, geo) => {
    const n = geo.attributes.position.count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { si[i * 4] = boneIndex[bone]; sw[i * 4] = 1; }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    if (!geo.index) geo = geo; // primitives are indexed
    parts[mat].push(geo);
  };

  const HC = [0, 1.43, 0.0];  // 머리 중심
  const HR = 0.118;

  // 머리
  add('skin', '頭', sphere(HC, HR, 1, 1.04, 1));
  add('skin', '首', limb([0, 1.22, 0], [0, 1.35, 0], 0.033));
  const faceGeo = new THREE.SphereGeometry(HR * 1.012, 24, 16, Math.PI / 2 - 0.95, 1.9, Math.PI * 0.30, Math.PI * 0.42);
  faceGeo.scale(1, 1.04, 1);
  faceGeo.translate(...HC);
  add('face', '頭', faceGeo);
  // 머리카락 공통: 뒤통수/옆, 앞머리
  add('hair', '頭', sphere([HC[0], HC[1] + 0.012, HC[2] - 0.016], HR * 1.07, 1.02, 1.05, 1.0, 20));
  const bangs = new THREE.SphereGeometry(HR * 1.085, 20, 10, Math.PI / 2 - 1.25, 2.5, 0, Math.PI * (st.hairStyle === 'short' ? 0.22 : 0.36));
  bangs.scale(1, 1.05, 1);
  bangs.translate(HC[0], HC[1] + 0.006, HC[2] + 0.004);
  add('hair', '頭', bangs);
  // 옆머리
  if (st.hairStyle !== 'short') {
    for (const sx of [-1, 1]) add('hair', '頭', boxG([sx * 0.112, 1.36, 0.035], 0.035, st.hairStyle === 'bob' ? 0.13 : 0.2, 0.05, [0, 0, sx * 0.08]));
  }
  if (st.hairStyle === 'long' || st.hairStyle === 'wavy') {
    add('hair', '頭', boxG([0, 1.16, -0.085], 0.25, 0.56, 0.06, [0.12, 0, 0]));
    add('hair', '頭', sphere([0, 0.9, -0.12], 0.13, 1, 0.5, 0.45));
    if (st.hairStyle === 'wavy') for (const sx of [-1, 1]) add('hair', '頭', sphere([sx * 0.11, 1.0, -0.08], 0.06, 1, 2.6, 0.9));
  } else if (st.hairStyle === 'bob') {
    add('hair', '頭', sphere([0, 1.38, -0.04], 0.13, 1.08, 0.75, 0.95));
  } else if (st.hairStyle === 'twin') {
    for (const sx of [-1, 1]) {
      add('hair', '頭', limb([sx * 0.12, 1.47, -0.05], [sx * 0.2, 0.98, -0.1], 0.045, 0.02, 10));
      add('hair', '頭', sphere([sx * 0.125, 1.47, -0.05], 0.05));
      add('deco', '頭', boxG([sx * 0.125, 1.5, -0.05], 0.03, 0.07, 0.11, [0, 0, sx * 0.5]));
    }
  }
  if (st.band) add('deco', '頭', (() => { const g = new THREE.TorusGeometry(HR * 1.08, 0.009, 6, 28, Math.PI); g.rotateY(Math.PI / 2); g.rotateX(-0.25); g.translate(HC[0], HC[1] + 0.02, HC[2] - 0.01); return g; })());
  if (st.pins) for (let i = 0; i < 2; i++) add('deco', '頭', boxG([0.07, 1.5 - i * 0.025, 0.09], 0.05, 0.01, 0.01, [0, 0, -0.5]));

  // 몸통 (블레이저) + 셔츠 깃 + 리본
  add('blazer', '上半身', limb([0, 0.88, 0], [0, 1.24, 0], 0.112, 0.125, 16));
  add('blazer', '上半身', sphere([0, 1.22, 0], 0.13, 1.25, 0.45, 0.85));
  add('shirt', '上半身', boxG([0, 1.17, 0.09], 0.09, 0.12, 0.02, [-0.2, 0, Math.PI / 4]));
  // 나비 리본
  for (const sx of [-1, 1]) add('accent', '上半身', boxG([sx * 0.024, 1.158, 0.116], 0.042, 0.03, 0.014, [0, 0, sx * 0.35]));
  add('accent', '上半身', sphere([0, 1.158, 0.12], 0.011));
  for (const sx of [-1, 1]) add('accent', '上半身', boxG([sx * 0.012, 1.128, 0.115], 0.014, 0.045, 0.01, [0, 0, sx * 0.25]));
  // 단추
  for (let i = 0; i < 2; i++) add('deco', '上半身', sphere([0.03, 1.02 + i * 0.06, 0.118], 0.008));
  // 치마
  add('skirt', '下半身', (() => { const g = new THREE.CylinderGeometry(0.115, 0.215, 0.3, 24, 1, true); g.translate(0, 0.72, 0); return g; })());
  add('blazer', '下半身', limb([0, 0.86, 0], [0, 0.9, 0], 0.113));

  // 팔
  for (const s of ['左', '右']) {
    add('blazer', s + '腕', sphere(pos[s + '腕'], 0.048));
    add('blazer', s + '腕', limb(pos[s + '腕'], pos[s + 'ひじ'], 0.044, 0.04));
    add('blazer', s + 'ひじ', sphere(pos[s + 'ひじ'], 0.041));
    add('blazer', s + 'ひじ', limb(pos[s + 'ひじ'], pos[s + '手首'], 0.04, 0.036));
    const sx = s === '左' ? 1 : -1;
    add('shirt', s + '手首', limb(pos[s + '手首'], [pos[s + '手首'][0] + sx * 0.015, pos[s + '手首'][1], 0], 0.037));
    add('skin', s + '手首', sphere([pos[s + '手首'][0] + sx * 0.055, pos[s + '手首'][1], 0], 0.04, 1.35, 0.7, 1));
    // 다리
    add('legs', s + '足', limb(pos[s + '足'], pos[s + 'ひざ'], 0.058, 0.046));
    add('legs', s + 'ひざ', sphere(pos[s + 'ひざ'], 0.047));
    add('legs', s + 'ひざ', limb(pos[s + 'ひざ'], [pos[s + 'ひざ'][0], 0.26, 0], 0.045, 0.038));
    add(st.legs === 'tights' ? 'legs' : 'socks', s + 'ひざ', limb([pos[s + 'ひざ'][0], 0.27, 0], pos[s + '足首'], 0.039, 0.033));
    add('shoe', s + '足首', boxG([pos[s + '足首'][0], 0.04, 0.035], 0.075, 0.07, 0.19));
  }

  // 머티리얼별로 합치고 그룹 구성
  const order = Object.keys(parts).filter((k) => parts[k].length);
  const perMat = order.map((k) => mergeGeometries(parts[k].map((g) => (g.index ? g : g.toNonIndexed())), false));
  const geo = mergeGeometries(perMat, true);
  geo.scale(U, U, U);
  geo.computeBoundingSphere();
  const material = order.map((k) => mats[k]);

  // 뼈 (회전 없음, 부모 기준 위치)
  const bones = BONES.map(([n]) => { const b = new THREE.Bone(); b.name = n; return b; });
  BONES.forEach(([, parent, x, y, z], i) => {
    if (parent) {
      const p = pos[parent];
      bones[i].position.set((x - p[0]) * U, (y - p[1]) * U, (z - p[2]) * U);
      bones[boneIndex[parent]].add(bones[i]);
    } else bones[i].position.set(x * U, y * U, z * U);
  });
  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.add(bones[0]);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));

  const faceStates = {};
  for (const s of ['open', 'closed', 'smile', 'angry', 'trouble']) faceStates[s] = faceTexture(st, s);
  mats.face.map = faceStates.open;
  return { mesh, faceStates, faceMatIndex: order.indexOf('face'), procedural: true };
}
