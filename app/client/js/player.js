// 로컬 플레이어: 이동/충돌/착석/카메라
import * as THREE from 'three';
import { ANIM } from './avatar.js';

const RADIUS = 0.27;
const CAP_BOTTOM = 0.3;   // 이보다 낮은 턱(계단 0.2m)은 충돌 무시 → 걸어서 올라감
const CAP_TOP = 1.55;
const STEP = 0.34;        // 바닥 레이 시작 높이 = 오를 수 있는 최대 턱
const WALK = 2.3, RUN = 4.8, GRAVITY = 20, JUMP = 5.4;

const _box = new THREE.Box3();
const _seg = new THREE.Line3();
const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class Player {
  constructor({ world, camera, canvas, prefs }) {
    this.world = world;
    this.camera = camera;
    this.canvas = canvas;
    this.prefs = prefs;
    this.pos = world.spawn.clone();
    this.vel = new THREE.Vector3();
    this.yaw = world.spawnYaw ?? Math.PI;       // 아바타가 바라보는 방향 (atan2(dx,dz))
    this.camYaw = 0;
    this.camPitch = -0.12;
    this.camDist = 3.4;
    this.grounded = true;
    this.anim = ANIM.idle;
    this.speed = 0;
    this.seat = null;
    this.keys = new Set();
    this.joy = new THREE.Vector2();
    this.firstPerson = !!prefs.firstPerson;
    this.avatar = null;
    this.enabled = true;
    this.camYaw = this.yaw + Math.PI; // 아바타 뒤에서 바라보기
    this._bindInput();
  }

  _bindInput() {
    const typing = () => /INPUT|TEXTAREA/.test(document.activeElement?.tagName);
    addEventListener('keydown', (e) => {
      if (typing()) return;
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    let drag = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' && this._joyId === e.pointerId) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const s = 0.005 * this.prefs.sens * (e.pointerType === 'touch' ? 1.4 : 1);
      this.camYaw -= (e.clientX - drag.x) * s;
      this.camPitch = THREE.MathUtils.clamp(this.camPitch - (e.clientY - drag.y) * s, -1.35, 1.2);
      drag.x = e.clientX; drag.y = e.clientY;
    });
    const end = (e) => { if (drag?.id === e.pointerId) drag = null; };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    this.canvas.addEventListener('wheel', (e) => {
      this.camDist = THREE.MathUtils.clamp(this.camDist * (e.deltaY > 0 ? 1.12 : 0.89), 1.2, 9);
      e.preventDefault();
    }, { passive: false });
  }

  bindJoystick(el, knob) {
    let id = null;
    let cx = 0, cy = 0;
    el.addEventListener('pointerdown', (e) => {
      id = e.pointerId; this._joyId = id;
      const r = el.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      el.setPointerCapture(id);
      e.stopPropagation();
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - cx, dy = e.clientY - cy;
      const l = Math.min(50, Math.hypot(dx, dy));
      const a = Math.atan2(dy, dx);
      this.joy.set(Math.cos(a) * l / 50, Math.sin(a) * l / 50);
      knob.style.transform = `translate(${Math.cos(a) * l}px, ${Math.sin(a) * l}px)`;
    });
    const up = (e) => { if (e.pointerId !== id) return; id = null; this._joyId = null; this.joy.set(0, 0); knob.style.transform = ''; };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  // ---------------------------------------------------------------- 착석
  nearestSeat() {
    if (this.seat) return null;
    let best = null, bd = 1.25;
    for (const s of this.world.seats) {
      const dy = s.pos.y - 0.45 - this.pos.y;
      if (Math.abs(dy) > 0.55) continue;
      const d = Math.hypot(s.pos.x - this.pos.x, s.pos.z - this.pos.z);
      if (d < bd && !s.occupant) { bd = d; best = s; }
    }
    return best;
  }
  sitAt(seat) {
    this.seat = seat;
    this.vel.set(0, 0, 0);
    this.yaw = seat.yaw;
    this.camYaw = seat.yaw + Math.PI;
    this.camPitch = 0.02;
    this.pos.copy(seat.pos);
    // 앉으면 1인칭(관객 시점)으로, 일어나면 원래 시점 복귀
    this._fpBeforeSit = this.firstPerson;
    this.firstPerson = true;
  }
  stand() {
    if (!this.seat) return;
    const s = this.seat;
    this.seat = null;
    this.firstPerson = this._fpBeforeSit ?? this.firstPerson;
    // 좌석 앞 통로로 일어남
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    this.pos.set(s.pos.x + fx * 0.48, s.pos.y - 0.45, s.pos.z + fz * 0.48);
    const h = this.world.groundHeight(this.pos, 0.6, 2);
    if (h != null) this.pos.y = h;
  }

  // ---------------------------------------------------------------- 매 프레임
  update(dt) {
    dt = Math.min(dt, 0.05);
    const k = this.keys;
    let ix = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + this.joy.x;
    let iz = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - this.joy.y;
    if (!this.enabled) ix = iz = 0;
    const moving = Math.hypot(ix, iz) > 0.15;

    if (this.seat) {
      if (moving) this.onStandRequest?.();
      this.anim = ANIM.sit;
      this.speed = 0;
      this._camera(dt);
      return;
    }

    const run = k.has('ShiftLeft') || k.has('ShiftRight') || Math.hypot(this.joy.x, this.joy.y) > 0.95;
    const fwd = new THREE.Vector3(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
    const right = new THREE.Vector3(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
    const wish = new THREE.Vector3().addScaledVector(fwd, iz).addScaledVector(right, ix);
    if (wish.lengthSq() > 1) wish.normalize();
    const target = wish.multiplyScalar(run ? RUN : WALK);
    const accel = this.grounded ? 14 : 3;
    this.vel.x += (target.x - this.vel.x) * Math.min(1, dt * accel);
    this.vel.z += (target.z - this.vel.z) * Math.min(1, dt * accel);
    if (this.grounded && k.has('Space') && this.enabled) { this.vel.y = JUMP; this.grounded = false; }
    this.vel.y -= GRAVITY * dt;

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;
    this._collide();

    // 바닥
    const h = this.world.groundHeight(this.pos, STEP + Math.max(0, this.vel.y * dt), 40);
    const snap = this.grounded ? 0.3 : 0.02;
    if (h != null && this.vel.y <= 0 && this.pos.y <= h + snap) {
      this.pos.y = h; this.vel.y = 0; this.grounded = true;
    } else if (h != null && this.pos.y < h) {
      this.pos.y = h; this.vel.y = Math.max(0, this.vel.y);
    } else this.grounded = false;
    if (this.pos.y < -20) { this.pos.copy(this.world.spawn); this.vel.set(0, 0, 0); }

    this.speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.speed > 0.3) {
      const want = Math.atan2(this.vel.x, this.vel.z);
      let d = want - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 12);
    }
    this.anim = !this.grounded ? ANIM.air : this.speed > 3.4 ? ANIM.run : this.speed > 0.3 ? ANIM.walk : ANIM.idle;
    this._camera(dt);
  }

  _collide() {
    const bvh = this.world.wallBVH;
    if (!bvh) return;
    for (let iter = 0; iter < 3; iter++) {
      _seg.start.set(this.pos.x, this.pos.y + CAP_BOTTOM + RADIUS, this.pos.z);
      _seg.end.set(this.pos.x, this.pos.y + CAP_TOP - RADIUS, this.pos.z);
      _box.makeEmpty().expandByPoint(_seg.start).expandByPoint(_seg.end);
      _box.min.addScalar(-RADIUS); _box.max.addScalar(RADIUS);
      let pushed = false;
      bvh.shapecast({
        intersectsBounds: (b) => b.intersectsBox(_box),
        intersectsTriangle: (tri) => {
          const d = tri.closestPointToSegment(_seg, _p1, _p2);
          if (d < RADIUS) {
            _dir.subVectors(_p2, _p1);
            _dir.y = 0; // 수평으로만 밀어냄
            const l = _dir.length();
            if (l < 1e-5) return;
            _dir.multiplyScalar((RADIUS - d) / l);
            _seg.start.add(_dir); _seg.end.add(_dir);
            pushed = true;
          }
        },
      });
      const dx = _seg.start.x - this.pos.x, dz = _seg.start.z - this.pos.z;
      this.pos.x += dx; this.pos.z += dz;
      if (!pushed) break;
    }
  }

  get eyeHeight() { return this.avatar ? this.avatar.headHeight + 0.02 : 1.45; }

  _camera(dt) {
    const cam = this.camera;
    const sitting = !!this.seat;
    const base = sitting ? this.seat.pos.clone().add(new THREE.Vector3(0, this.eyeHeight - (this.avatar?.hipHeight ?? 0.8) + 0.04, 0)) : this.pos.clone().add(new THREE.Vector3(0, this.eyeHeight, 0));
    const dir = new THREE.Vector3(-Math.sin(this.camYaw) * Math.cos(this.camPitch), Math.sin(this.camPitch), -Math.cos(this.camYaw) * Math.cos(this.camPitch));
    if (this.firstPerson) {
      cam.position.copy(base).addScaledVector(dir, 0.08);
      cam.lookAt(base.clone().add(dir));
      if (this.avatar) this.avatar.root.visible = false;
      return;
    }
    if (this.avatar) this.avatar.root.visible = true;
    const pivot = base.clone().add(new THREE.Vector3(0, 0.1, 0));
    let dist = this.camDist;
    const ray = new THREE.Ray(pivot, dir.clone().negate());
    const hit = this.world.wallBVH?.raycastFirst(ray, THREE.DoubleSide, 0, dist + 0.3);
    if (hit) dist = Math.max(0.4, hit.distance - 0.25);
    this._camDistSmooth = this._camDistSmooth == null ? dist : Math.min(dist, this._camDistSmooth + dt * 4);
    if (dist < this._camDistSmooth) this._camDistSmooth = dist;
    cam.position.copy(pivot).addScaledVector(dir, -this._camDistSmooth);
    cam.lookAt(pivot);
    // 카메라가 아바타 안으로 너무 들어오면 아바타 숨김
    if (this.avatar) this.avatar.mesh.visible = this._camDistSmooth > 0.55;
  }

  netState() {
    return [this.seat ? this.seat.pos.x : this.pos.x, this.seat ? this.seat.pos.y - 0.45 : this.pos.y, this.seat ? this.seat.pos.z : this.pos.z, this.yaw, this.anim];
  }
}
