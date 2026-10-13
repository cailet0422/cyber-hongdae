// 맵(GLB) 로드: 충돌체 BVH, 좌석, 조명 풀, 디스플레이 메시, 인스턴싱
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';

const LIGHT_SCALE = 4.5;
// 조명 풀: 종류별 고정 개수(셰이더 재컴파일 방지). 가까운 조명 몇 개만 켜고, 나머지 칸은 꺼지는 조명이 서서히 사라질 여유
const POOL = { spot: 10, point: 4 };
const SPARE = 2;          // 종류별로 꺼지는 중인 조명에 남겨 두는 칸
const FADE = 3;           // 초당 밝기 변화 (1/FADE초에 완전히 켜지거나 꺼짐)
const KEEP_BONUS = 0.75;  // 이미 켜진 조명은 점수를 깎아 경계에서 켰다 껐다 반복하지 않게 함

export class World {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.seats = [];
    this.seatById = new Map();
    this.displays = {};
    this.posterMats = []; // 포스터 아틀라스 머티리얼 (서버 포스터 설정으로 텍스처를 교체)
    this.lightDefs = [];
    this.zones = {};
    this.spawn = new THREE.Vector3(18.65, 0, 54.23);   // 맵의 SPAWN이 없을 때: 엘리베이터 앞 (동쪽 사인을 바라봄)
    this.spawnYaw = Math.PI / 2;
    this.wallBVH = null;
    this.groundBVH = null;
    this.theaterDim = 0; // 0: 밝음, 1: 상영 중 어두움
    this.slots = [];
  }

  async load(url, onProgress) {
    const gltf = await new GLTFLoader().loadAsync(url, (e) => e.total && onProgress?.(e.loaded / e.total));
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const maxAniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

    const wallGeos = [];
    const groundGeos = [];
    const flag = (o, k) => { for (let p = o; p; p = p.parent) if (p.userData && p.userData[k]) return p.userData[k]; return 0; };
    const meshes = [];
    root.traverse((o) => {
      const ud = o.userData || {};
      if (ud.seat) {
        const p = o.getWorldPosition(new THREE.Vector3());
        const s = { id: ud.seat, row: ud.row, num: ud.num, pos: p, yaw: Math.PI / 2, occupant: null };
        this.seats.push(s);
        this.seatById.set(s.id, s);
      }
      if (ud.spawn) { o.getWorldPosition(this.spawn); if (typeof ud.yaw === 'number') this.spawnYaw = ud.yaw; }
      if (ud.light) {
        this.lightDefs.push({
          kind: ud.light === 'spot' ? 'spot' : 'point',
          pos: o.getWorldPosition(new THREE.Vector3()), color: new THREE.Color().fromArray(ud.color).convertLinearToSRGB(),
          intensity: ud.intensity, distance: ud.distance, theater: !!ud.theater,
          angle: THREE.MathUtils.degToRad(ud.angle || 55), penumbra: ud.penumbra ?? 0.6,
          w: 0, want: false, slot: null,
        });
      }
      if (ud.zone) {
        const c = o.getWorldPosition(new THREE.Vector3());
        this.zones[ud.zone] = new THREE.Box3().setFromCenterAndSize(c, new THREE.Vector3(ud.su, ud.sz, ud.sv));
      }
      if (ud.projector) this.projector = o.getWorldPosition(new THREE.Vector3());
      if (o.isMesh) meshes.push(o);
    });

    for (const m of meshes) {
      const display = flag(m, 'display');
      if (display) {
        const ud = m.userData.display ? m.userData : m.parent.userData;
        this.displays[display] = { mesh: m, w: ud.w, h: ud.h };
      }
      const collide = flag(m, 'collide');
      const floor = flag(m, 'floor');
      if (collide || floor) {
        let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
        g.applyMatrix4(m.matrixWorld);
        if (collide) wallGeos.push(g);
        groundGeos.push(g);
      }
      if (flag(m, 'invisible')) { m.visible = false; continue; }
      // 머티리얼 보정
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        if (mat.map) { mat.map.anisotropy = maxAniso; }
        if (mat.emissiveMap) mat.emissiveMap.anisotropy = maxAniso;
        if (mat.transparent) { mat.depthWrite = false; }
        if (/glow_cone|graffiti/.test(mat.name) && mat.transparent) { mat.blending = THREE.AdditiveBlending; mat.depthWrite = false; }
        if (mat.name === 'glass') { mat.opacity = 0.12; mat.transparent = true; mat.depthWrite = false; }
        if (mat.name === 'invisible') m.visible = false;
        if (mat.name === 'posters' && !this.posterMats.includes(mat)) this.posterMats.push(mat);
      }
      m.matrixAutoUpdate = false;
    }

    this.wallBVH = wallGeos.length ? new MeshBVH(mergeGeometries(wallGeos)) : null;
    this.groundBVH = new MeshBVH(mergeGeometries(groundGeos));
    this._instance(root);
    this.scene.add(root);
    this.root = root;
    this._setupLights();
    this._projectorBeam();
    return this;
  }

  // 같은 지오메트리를 쓰는 메시(좌석 187개 등)를 InstancedMesh로 합쳐 드로우콜을 줄인다
  _instance(root) {
    const byGeo = new Map();
    root.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      const key = o.geometry.uuid + '|' + o.material.uuid;
      if (!byGeo.has(key)) byGeo.set(key, []);
      byGeo.get(key).push(o);
    });
    for (const list of byGeo.values()) {
      if (list.length < 8) continue;
      const im = new THREE.InstancedMesh(list[0].geometry, list[0].material, list.length);
      list.forEach((m, i) => { m.updateMatrixWorld(true); im.setMatrixAt(i, m.matrixWorld); m.parent.remove(m); });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      root.add(im);
    }
  }

  // 조명 풀: 고정 개수의 스포트/포인트 라이트를 카메라 근처 조명 자리에 배정한다.
  // 배정이 바뀔 때 밝기를 0으로 끊지 않고, 각 조명이 서서히 켜지고 꺼지게 해서 달릴 때 깜빡이지 않게 한다.
  _setupLights() {
    this.hemi = new THREE.HemisphereLight(0xcfd6ff, 0x3a3028, 0.85);
    this.scene.add(this.hemi);
    this.slots = [];
    for (const kind of ['spot', 'point']) {
      for (let i = 0; i < POOL[kind]; i++) {
        const l = kind === 'spot' ? new THREE.SpotLight(0xffffff, 0, 10, 0.9, 0.6, 1.6) : new THREE.PointLight(0xffffff, 0, 10, 1.6);
        this.scene.add(l);
        if (kind === 'spot') this.scene.add(l.target);
        this.slots.push({ kind, light: l, def: null });
      }
    }
    this._selT = 0;
  }

  _assign(slot, d) {
    if (slot.def) { slot.def.slot = null; slot.def.w = 0; }
    slot.def = d;
    d.slot = slot;
    d.w = 0;
    const l = slot.light;
    l.position.copy(d.pos);
    l.color.copy(d.color);
    l.distance = d.distance * 1.4;
    l.intensity = 0;
    if (slot.kind === 'spot') {
      l.angle = d.angle;
      l.penumbra = d.penumbra;
      l.target.position.set(d.pos.x, d.pos.y - 10, d.pos.z);
      l.target.updateMatrixWorld();
    }
  }

  // 상영관 안에서는 상영관 조명만, 밖에서는 상영관 조명을 빼고 고른다 (그림자가 없어 벽 너머로 새지 않게)
  _select(camPos, inTheater) {
    for (const d of this.lightDefs) d.want = false;
    for (const kind of ['spot', 'point']) {
      const ranked = [];
      for (const d of this.lightDefs) {
        if (d.kind !== kind || d.theater !== inTheater) continue;
        let k = d.pos.distanceToSquared(camPos) / (d.distance * d.distance);
        if (d.slot) k *= KEEP_BONUS;
        ranked.push([k, d]);
      }
      ranked.sort((a, b) => a[0] - b[0]);
      const want = ranked.slice(0, POOL[kind] - SPARE).map((x) => x[1]);
      for (const d of want) d.want = true;
      const slots = this.slots.filter((s) => s.kind === kind);
      for (const d of want) {
        if (d.slot) continue;
        // 빈 칸 → 없으면 원하지 않는 조명 중 가장 어두워진 칸을 넘겨받음
        let slot = slots.find((s) => !s.def);
        if (!slot) {
          const free = slots.filter((s) => !s.def.want).sort((a, b) => a.def.w - b.def.w);
          slot = free[0];
        }
        if (slot) this._assign(slot, d);
      }
    }
  }

  updateLights(dt, camPos, inTheater) {
    this._selT -= dt;
    if (this._selT <= 0) {
      this._selT = 0.15;
      this._select(camPos, !!inTheater);
    }
    const dim = this.theaterDim;
    const step = Math.min(1, dt * FADE);
    for (const s of this.slots) {
      const d = s.def;
      if (!d) continue;
      d.w = d.want ? Math.min(1, d.w + step) : Math.max(0, d.w - step);
      if (!d.want && d.w === 0) {
        d.slot = null;
        s.def = null;
        s.light.intensity = 0;
        continue;
      }
      let target = d.intensity * LIGHT_SCALE;
      if (d.theater && d.color.b < 0.9) target *= 1 - 0.85 * dim; // 상영 중 객석 조명 어둡게
      const e = d.w * d.w * (3 - 2 * d.w);                          // 부드러운 켜짐/꺼짐
      s.light.intensity = target * e;
    }
    const hemiTarget = inTheater ? 0.35 - 0.25 * dim : 0.85;
    this.hemi.intensity += (hemiTarget - this.hemi.intensity) * Math.min(1, dt * 2);
  }

  // 영사기 빛줄기
  _projectorBeam() {
    const scr = this.displays.screen4;
    if (!this.projector || !scr) return;
    scr.mesh.geometry.computeBoundingBox();
    const bb = scr.mesh.geometry.boundingBox.clone().applyMatrix4(scr.mesh.matrixWorld);
    const p = this.projector;
    const x = bb.min.x - 0.05;
    const corners = [[bb.min.z, bb.min.y], [bb.max.z, bb.min.y], [bb.max.z, bb.max.y], [bb.min.z, bb.max.y]].map(([z, y]) => new THREE.Vector3(x, y, z));
    const pos = [];
    const t = [];
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      pos.push(p.x, p.y, p.z, a.x, a.y, a.z, b.x, b.y, b.z);
      t.push(0, 1, 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('t', new THREE.Float32BufferAttribute(t, 1));
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0.7, 0.75, 1) }, uOpacity: { value: 0 } },
      vertexShader: 'attribute float t; varying float vT; void main(){ vT=t; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
      fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; varying float vT; void main(){ float a = uOpacity * (0.25 + 0.75*(1.0 - vT)) * 0.11; gl_FragColor = vec4(uColor*a, 1.0);} ',
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(g, this.beamMat);
    beam.frustumCulled = false;
    this.scene.add(beam);
  }

  inZone(name, p) { return this.zones[name]?.containsPoint(p) ?? false; }

  // 바닥 높이 (위에서 아래로 레이)
  groundHeight(pos, from = 0.5, maxDown = 3) {
    const ray = new THREE.Ray(new THREE.Vector3(pos.x, pos.y + from, pos.z), new THREE.Vector3(0, -1, 0));
    const hit = this.groundBVH.raycastFirst(ray, THREE.DoubleSide, 0, from + maxDown);
    return hit ? hit.point.y : null;
  }
}
