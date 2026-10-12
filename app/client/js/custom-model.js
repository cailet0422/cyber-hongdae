// 사용자 커스텀 3D 모델: 형식별 로딩 + ZIP(텍스처 포함) 처리 + 휴머노이드 뼈 자동 인식
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { TDSLoader } from 'three/addons/loaders/TDSLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { unzipSync, zipSync } from 'three/addons/libs/fflate.module.js';

// 우선순위 순서 (ZIP 안에서 본체 파일을 고를 때 사용)
export const MODEL_EXT = ['vrm', 'glb', 'gltf', 'pmx', 'pmd', 'fbx', 'dae', 'obj', '3ds', 'stl', 'ply'];
export const ACCEPT = [...MODEL_EXT, 'zip', 'mtl', 'bin', 'png', 'jpg', 'jpeg', 'tga', 'bmp', 'webp', 'dds', 'sph', 'spa', 'gif', 'tif', 'tiff', 'ktx2']
  .map((e) => '.' + e).join(',');
export const MAX_TRIANGLES = 500000;

const extOf = (n) => (String(n).split(/[?#]/)[0].split('.').pop() || '').toLowerCase();
const baseName = (p) => String(p).replace(/\\/g, '/').split('/').pop();

// ------------------------------------------------------------------ 파일 묶기 (여러 파일/폴더 → ZIP)
export async function packFiles(fileList) {
  const files = [...fileList];
  if (!files.length) throw new Error('파일이 없습니다');
  const main = pickMain(files.map((f) => f.webkitRelativePath || f.name));
  if (files.length === 1) {
    const f = files[0];
    const ext = extOf(f.name);
    if (ext !== 'zip' && !MODEL_EXT.includes(ext)) throw new Error('지원하지 않는 형식입니다: .' + ext);
    return { data: new Uint8Array(await f.arrayBuffer()), ext, name: f.name };
  }
  if (!main) throw new Error('모델 파일(vrm, glb, gltf, fbx, obj, pmx, pmd, dae, 3ds, stl, ply)이 없습니다');
  const entries = {};
  for (const f of files) {
    const p = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
    entries[p] = new Uint8Array(await f.arrayBuffer());
  }
  return { data: zipSync(entries, { level: 6 }), ext: 'zip', name: baseName(main).replace(/\.[^.]+$/, '') + '.zip' };
}

function pickMain(names) {
  for (const e of MODEL_EXT) {
    const n = names.find((x) => extOf(x) === e && !/__macosx/i.test(x));
    if (n) return n;
  }
  return null;
}

// ZIP 안 파일 이름: UTF-8 플래그가 없으면 CP949/Shift_JIS로도 해석해 본다
function nameVariants(name) {
  const out = new Set([name]);
  const bytes = Uint8Array.from([...name].map((c) => c.charCodeAt(0) & 0xff));
  if ([...name].every((c) => c.charCodeAt(0) < 256)) {
    for (const enc of ['euc-kr', 'shift_jis', 'utf-8']) {
      try { out.add(new TextDecoder(enc, { fatal: true }).decode(bytes)); } catch {}
    }
  }
  return [...out];
}

// ------------------------------------------------------------------ 로딩
// src: { url, ext } (서버에 올라간 모델) 또는 { data: Uint8Array, ext } (업로드 전 미리보기)
export async function loadTemplate(src) {
  let data = src.data;
  if (!data) {
    const r = await fetch(src.url);
    if (!r.ok) throw new Error('모델 파일을 받을 수 없습니다 (' + r.status + ')');
    data = new Uint8Array(await r.arrayBuffer());
  }
  let ext = src.ext;
  const blobs = new Map(); // 소문자 파일명 → blob URL
  const revoke = [];
  let mainName = 'model.' + ext;
  let mainData = data;
  if (ext === 'zip') {
    let files;
    try { files = unzipSync(data); } catch { throw new Error('ZIP 파일을 풀 수 없습니다'); }
    const names = Object.keys(files).filter((n) => !n.endsWith('/'));
    const main = pickMain(names);
    if (!main) throw new Error('ZIP 안에 모델 파일이 없습니다');
    ext = extOf(main);
    mainName = baseName(main);
    mainData = files[main];
    for (const n of names) {
      const url = URL.createObjectURL(new Blob([files[n]]));
      revoke.push(url);
      for (const v of nameVariants(n)) {
        blobs.set(v.toLowerCase(), url);
        blobs.set(baseName(v).toLowerCase(), url);
      }
    }
  }
  const mainUrl = URL.createObjectURL(new Blob([mainData]));
  revoke.push(mainUrl);
  const fakeMain = 'custom/' + mainName.replace(/[^\w.\-]/g, '_').replace(/\.[^.]+$/, '') + '.' + ext;

  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (url === fakeMain) return mainUrl;
    if (/^(blob:|data:)/.test(url)) return url;
    let p = url;
    try { p = decodeURIComponent(url); } catch {}
    p = p.replace(/\\/g, '/').replace(/^custom\//, '').replace(/^\.\//, '');
    return blobs.get(p.toLowerCase()) || blobs.get(baseName(p).toLowerCase()) || url;
  });
  manager.addHandler(/\.tga$/i, new TGALoader(manager));
  const buf = mainData.buffer.slice(mainData.byteOffset, mainData.byteOffset + mainData.byteLength);
  const text = () => new TextDecoder().decode(mainData);

  const tpl = { kind: 'static', ext, clips: [] };
  if (ext === 'vrm' || ext === 'glb' || ext === 'gltf') {
    const vrmMod = ext === 'vrm' || containsVrm(mainData) ? await import('@pixiv/three-vrm') : null;
    const make = async () => {
      const loader = new GLTFLoader(manager);
      if (vrmMod) loader.register((p) => new vrmMod.VRMLoaderPlugin(p));
      const g = await loader.parseAsync(ext === 'gltf' ? text() : buf, 'custom/');
      const vrm = g.userData.vrm || null;
      if (vrm) {
        vrmMod.VRMUtils.removeUnnecessaryVertices?.(g.scene);
        vrmMod.VRMUtils.combineSkeletons?.(g.scene);
        vrmMod.VRMUtils.rotateVRM0(vrm); // VRM0.x는 -Z를 바라보므로 +Z로 맞춤
        vrm.scene.traverse((o) => { o.frustumCulled = false; });
      }
      return { object: vrm ? vrm.scene : g.scene, vrm, clips: g.animations || [] };
    };
    const first = await make();
    tpl.kind = first.vrm ? 'vrm' : 'gltf';
    tpl.clips = first.clips;
    // VRM은 내부 상태(스프링본·표정)가 있어 아바타마다 다시 파싱, 일반 glTF는 복제
    let used = false;
    tpl.instantiate = async () => {
      if (!used) { used = true; return first; }
      if (first.vrm) return make();
      return { object: SkeletonUtils.clone(first.object), clips: first.clips };
    };
    tpl.sample = first.object;
  } else {
    let object;
    if (ext === 'fbx') object = new FBXLoader(manager).parse(buf, 'custom/');
    else if (ext === 'obj') {
      const loader = new OBJLoader(manager);
      const mtlName = [...blobs.keys()].find((k) => k.endsWith('.mtl'));
      if (mtlName) {
        const mtlText = await (await fetch(blobs.get(mtlName))).text();
        const mtl = new MTLLoader(manager).setResourcePath('custom/').parse(mtlText, 'custom/');
        mtl.preload();
        loader.setMaterials(mtl);
      }
      object = loader.parse(text());
    } else if (ext === 'dae') object = new ColladaLoader(manager).parse(text(), 'custom/').scene;
    else if (ext === '3ds') object = new TDSLoader(manager).parse(buf, 'custom/');
    else if (ext === 'stl' || ext === 'ply') {
      const geo = ext === 'stl' ? new STLLoader().parse(buf) : new PLYLoader().parse(buf);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      const hasColor = !!geo.attributes.color;
      object = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: hasColor ? 0xffffff : 0xb8bcc8, vertexColors: hasColor, roughness: 0.6 }));
      // STL은 보통 Z가 위 → Y가 위로
      if (ext === 'stl') object.rotation.x = -Math.PI / 2;
      const g = new THREE.Group(); g.add(object); object = g;
    } else if (ext === 'pmx' || ext === 'pmd') {
      object = await new Promise((res, rej) => new MMDLoader(manager).load(fakeMain, res, undefined, (e) => rej(new Error('MMD 모델을 읽지 못했습니다: ' + (e?.message || e)))));
      tpl.kind = 'mmd';
    } else throw new Error('지원하지 않는 형식입니다: .' + ext);
    if (tpl.kind !== 'mmd') tpl.kind = 'rigged';
    tpl.clips = object.animations || [];
    object.traverse((o) => { if (o.isSkinnedMesh) o.frustumCulled = false; });
    tpl.instantiate = async () => ({ object: SkeletonUtils.clone(object), clips: tpl.clips });
    tpl.sample = object;
  }
  tpl.triangles = countTriangles(tpl.sample);
  if (tpl.triangles > MAX_TRIANGLES) throw new Error(`폴리곤이 너무 많습니다 (${Math.round(tpl.triangles / 1000)}k / 최대 ${MAX_TRIANGLES / 1000}k)`);
  tpl.dispose = () => revoke.forEach((u) => URL.revokeObjectURL(u));
  // 텍스처 로딩이 끝날 시간을 준 뒤 blob URL 정리
  setTimeout(() => tpl.dispose(), 120000);
  return tpl;
}

function containsVrm(u8) {
  // glb JSON 청크에 VRM 확장이 있는지 (확장자를 .glb로 바꾼 VRM 대응)
  const head = new TextDecoder().decode(u8.subarray(0, Math.min(u8.length, 200000)));
  return /"VRMC?_vrm"|"VRM"\s*:/.test(head);
}

function countTriangles(obj) {
  let n = 0;
  obj.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    n += g.index ? g.index.count / 3 : (g.attributes.position?.count || 0) / 3;
  });
  return Math.round(n);
}

// ------------------------------------------------------------------ 휴머노이드 뼈 인식
// 결과 키: hips spine chest neck head lUpper lLower lHand rUpper rLower rHand lThigh lShin lFoot rThigh rShin rFoot
const KIND_RE = [
  ['hand', /^(hand|wrist|手首)$/],
  ['lower', /^(lowerarm|forearm|loarm|elbow|ひじ|ヒジ)$/],
  ['upper', /^(upperarm|uparm|arm|shldr|腕)$/],
  ['foot', /^(foot|ankle|足首)$/],
  ['shin', /^(lowerleg|leg|calf|shin|knee|ひざ|ヒザ)$/],
  ['thigh', /^(upperleg|upleg|thigh|足)$/],
];
const CENTER_RE = [
  ['hips', /^(hips|hip|pelvis|センター|下半身)$/],
  ['spine', /^(spine|spine0?1|spine0|上半身|torso|abdomen|waist)$/],
  ['chest', /^(chest|upperchest|spine0?2|spine0?3|上半身2|chest2)$/],
  ['neck', /^(neck|neck0?1|首)$/],
  ['head', /^(head|頭)$/],
];

function parseBoneName(raw) {
  let s = String(raw).replace(/^.*[|]/, '').replace(/^(mixamorig\d*|armature)[:_]?(?=[A-Za-z])/i, '');
  let side = null;
  if (/左/.test(s)) { side = 'l'; s = s.replace('左', ''); }
  else if (/右/.test(s)) { side = 'r'; s = s.replace('右', ''); }
  else if (/left/i.test(s)) { side = 'l'; s = s.replace(/left/i, ''); }
  else if (/right/i.test(s)) { side = 'r'; s = s.replace(/right/i, ''); }
  else {
    const m = s.match(/(^|[\s_.\-:])([lr])($|[\s_.\-:])/i);
    if (m) { side = m[2].toLowerCase(); s = s.replace(m[0], m[1] || m[3] ? ' ' : ''); }
    else if (/^[lr](?=[A-Z])/.test(s)) { side = s[0]; s = s.slice(1); }
    // GLTFLoader가 '.'을 지워 "UpperArm.L" → "UpperArmL"이 되는 경우
    else if (/[a-z][LR]$/.test(s)) { side = s.slice(-1).toLowerCase(); s = s.slice(0, -1); }
  }
  const base = s.toLowerCase().replace(/[\s_.\-:|]/g, '').replace(/^(bip0?1|def|ccbase|jbip[clr]?|j|bn|bone|b|org)(?=[a-z一-龠ぁ-ん])/, '');
  return { side, base };
}

export function detectRig(object, vrm) {
  const bones = {};
  if (vrm?.humanoid) {
    const map = {
      hips: 'hips', spine: 'spine', chest: 'chest', neck: 'neck', head: 'head',
      lUpper: 'leftUpperArm', lLower: 'leftLowerArm', lHand: 'leftHand', rUpper: 'rightUpperArm', rLower: 'rightLowerArm', rHand: 'rightHand',
      lThigh: 'leftUpperLeg', lShin: 'leftLowerLeg', lFoot: 'leftFoot', rThigh: 'rightUpperLeg', rShin: 'rightLowerLeg', rFoot: 'rightFoot',
    };
    for (const [k, v] of Object.entries(map)) { const n = vrm.humanoid.getNormalizedBoneNode(v); if (n) bones[k] = n; }
  } else {
    const all = [];
    object.traverse((o) => { if (o.isBone || (o.type === 'Object3D' && /bip|mixamo|hips|spine|arm|leg/i.test(o.name))) all.push(o); });
    for (const b of all) {
      const { side, base } = parseBoneName(b.name);
      if (side) {
        for (const [kind, re] of KIND_RE) {
          if (!re.test(base)) continue;
          const key = side + { upper: 'Upper', lower: 'Lower', hand: 'Hand', thigh: 'Thigh', shin: 'Shin', foot: 'Foot' }[kind];
          if (!bones[key]) bones[key] = b;
          break;
        }
      } else {
        for (const [key, re] of CENTER_RE) if (re.test(base) && !bones[key]) { bones[key] = b; break; }
      }
    }
    // 'leg'만 있고 'upleg'가 없는 리그: leg = 허벅지
    for (const s of ['l', 'r']) {
      if (!bones[s + 'Thigh'] && bones[s + 'Shin']) {
        const kids = bones[s + 'Shin'].children.find((c) => c.isBone);
        if (kids && !bones[s + 'Foot']) { bones[s + 'Thigh'] = bones[s + 'Shin']; bones[s + 'Shin'] = kids; }
      }
    }
  }
  const need = ['lUpper', 'lLower', 'rUpper', 'rLower', 'lThigh', 'lShin', 'rThigh', 'rShin'];
  const humanoid = need.every((k) => bones[k]);
  return { bones, humanoid };
}
