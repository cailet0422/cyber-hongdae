// 기본 캐릭터: 얼굴 없는 인체 마네킹 (클린룸 — 외부 모델 데이터 없이 코드로 스켈레톤과 메시를 만든다)
// 뼈 이름은 MMD 규격을 따라 걷기/착석/이모트/응원봉 애니메이션을 PMD 모델과 똑같이 쓸 수 있다.
// 몸통·팔·다리·손·발은 단면을 쌓은 관, 머리는 변형한 구. 관절 근처는 두 뼈에 부드럽게 나눠 스키닝하고
// 팔꿈치·무릎·고관절 중심에는 숨은 구를 넣어 크게 굽혀도(착석) 관절이 꺼져 보이지 않게 한다.
import * as THREE from 'three';

const U = 12.5; // m → MMD 단위 (아바타가 0.08배로 축소해서 표시)

// 캐릭터별 몸 색: CHAR_INFO 테마색을 옅게 한 무광 파스텔 (빨강은 살색으로 보이지 않게 채도를 남김)
const BODY = { yui: '#e66a64', mio: '#a0b8f5', ritsu: '#f6cc6a', mugi: '#f5b2d6', azusa: '#98daac' };

// ------------------------------------------------------------------ 스켈레톤
// [이름, 부모, x, y, z] (모델 공간, 미터) — 모델은 +Z를 바라보고 왼쪽이 +X. 키 1.62m, 팔은 40° 내린 A자 자세
const BONES = [
  ['センター', null, 0, 0.82, 0],
  ['下半身', 'センター', 0, 0.90, 0],
  ['上半身', 'センター', 0, 0.93, 0],
  ['首', '上半身', 0, 1.37, -0.01],
  ['頭', '首', 0, 1.44, 0],
  ['左肩', '上半身', 0.045, 1.32, -0.01], ['左腕', '左肩', 0.16, 1.31, -0.01], ['左ひじ', '左腕', 0.382, 1.1235, -0.01], ['左手首', '左ひじ', 0.566, 0.969, -0.01],
  ['右肩', '上半身', -0.045, 1.32, -0.01], ['右腕', '右肩', -0.16, 1.31, -0.01], ['右ひじ', '右腕', -0.382, 1.1235, -0.01], ['右手首', '右ひじ', -0.566, 0.969, -0.01],
  ['左足', '下半身', 0.085, 0.83, 0], ['左ひざ', '左足', 0.085, 0.455, 0.005], ['左足首', '左ひざ', 0.085, 0.075, -0.012],
  ['右足', '下半身', -0.085, 0.83, 0], ['右ひざ', '右足', -0.085, 0.455, 0.005], ['右足首', '右ひざ', -0.085, 0.075, -0.012],
];

// ------------------------------------------------------------------ 보조 함수
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const gauss = (x, m, s) => Math.exp(-0.5 * ((x - m) / s) ** 2);
const gA = (t, m, s) => gauss(Math.atan2(Math.sin(t - m), Math.cos(t - m)), 0, s); // 각도용
const spow = (v, e) => Math.sign(v) * Math.abs(v) ** e;
const BACK = -Math.PI / 2, FRONT = Math.PI / 2; // 단면 각도: 0 = 바깥(+X), π/2 = 앞(+Z)

// 표 보간 (3차 에르미트). rows: [[x, a, b, ...], ...]
function table(rows) {
  rows = [...rows].sort((a, b) => a[0] - b[0]);
  return (x) => {
    let i = 0;
    while (i < rows.length - 2 && x > rows[i + 1][0]) i++;
    const p0 = rows[i - 1] || rows[i], p1 = rows[i], p2 = rows[i + 1], p3 = rows[i + 2] || p2;
    const h = p2[0] - p1[0], t = Math.min(1, Math.max(0, (x - p1[0]) / h)), t2 = t * t, t3 = t2 * t;
    const out = [];
    for (let k = 1; k < p1.length; k++) {
      const m1 = ((p2[k] - p0[k]) / (p2[0] - p0[0])) * h, m2 = ((p3[k] - p1[k]) / (p3[0] - p1[0])) * h;
      out.push((2 * t3 - 3 * t2 + 1) * p1[k] + (t3 - 2 * t2 + t) * m1 + (3 * t2 - 2 * t3) * p2[k] + (t3 - t2) * m2);
    }
    return out;
  };
}

// 정점·삼각형·스킨 가중치 모음. sx = -1 이면 좌우 반전(오른쪽)해서 넣는다
class Builder {
  constructor(bi) { this.bi = bi; this.pos = []; this.si = []; this.sw = []; this.idx = []; this.sx = 1; this.parts = {}; }
  // 부품 구간 표시 (이음매 법선 섞기용)
  mark(name) {
    const n = this.pos.length / 3;
    if (this.cur) this.cur.end = n;
    this.cur = name ? (this.parts[name] = { start: n, end: n }) : null;
  }
  v(p, w) {
    this.pos.push(p.x * this.sx, p.y, p.z);
    const ws = w.filter((x) => x[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = ws.reduce((s, x) => s + x[1], 0);
    for (let k = 0; k < 4; k++) { this.si.push(ws[k] ? this.bi[ws[k][0]] : 0); this.sw.push(ws[k] ? ws[k][1] / sum : 0); }
    return this.pos.length / 3 - 1;
  }
  t(a, b, c) { if (this.sx > 0) this.idx.push(a, b, c); else this.idx.push(a, c, b); }
}

// 링을 이어 관을 만든다. rings[i]: Vector3[] (점 하나면 끝을 닫는 극점). w: [[뼈, 가중치], ...] 또는 p → 그 배열
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
function tube(B, rings, w) {
  const ids = rings.map((r) => r.map((p) => B.v(p, typeof w === 'function' ? w(p) : w)));
  // 면이 바깥을 향하도록 감기 방향 판정
  let dot = 0;
  for (let i = 0; i < rings.length - 1; i++) {
    const A = rings[i], C = rings[i + 1];
    if (A.length < 2 || C.length < 2) continue;
    const ctr = A.reduce((s, p) => s.add(p), v3(0, 0, 0)).divideScalar(A.length);
    for (let j = 0; j < A.length; j++) {
      const a = A[j], b = A[(j + 1) % A.length], c = C[(j + 1) % A.length];
      dot += _a.subVectors(b, a).cross(_b.subVectors(c, a)).dot(_c.subVectors(a, ctr));
    }
  }
  const tri = dot < 0 ? (a, b, c) => B.t(a, c, b) : (a, b, c) => B.t(a, b, c);
  for (let i = 0; i < ids.length - 1; i++) {
    const A = ids[i], C = ids[i + 1], m = Math.max(A.length, C.length);
    for (let j = 0; j < m; j++) {
      const j1 = (j + 1) % m;
      if (A.length === 1) tri(A[0], C[j1], C[j]);
      else if (C.length === 1) tri(A[j], A[j1], C[0]);
      else { tri(A[j], A[j1], C[j1]); tri(A[j], C[j1], C[j]); }
    }
  }
}

// 단면 목록 → 링 목록. sec: { c, e1, e2, f: θ → [u, v] }. capA/capB: 양 끝을 반구 모양으로 닫는 길이
function stack(secs, M, capA = 0, capB = 0, K = 3) {
  const ring = (s, k = 1, off = null) => Array.from({ length: M }, (_, j) => {
    const [u, v] = s.f((j / M) * Math.PI * 2);
    const p = s.c.clone().addScaledVector(s.e1, u * k).addScaledVector(s.e2, v * k);
    return off ? p.add(off) : p;
  });
  const cap = (s, nb, L) => {
    const d = s.c.clone().sub(nb.c).normalize(), out = [];
    for (let i = 1; i < K; i++) { const ph = (i / K) * (Math.PI / 2); out.push(ring(s, Math.cos(ph), d.clone().multiplyScalar(L * Math.sin(ph)))); }
    out.push([s.c.clone().addScaledVector(d, L)]);
    return out;
  };
  const n = secs.length;
  return [...(capA ? cap(secs[0], secs[1], capA).reverse() : []), ...secs.map((s) => ring(s)), ...(capB ? cap(secs[n - 1], secs[n - 2], capB) : [])];
}

// 중심선을 따라 원형 단면 관 (손가락). ref: 단면 기준 방향 (중심선과 평행하지 않게)
function digit(B, pts, rs, ref, w, M = 6) {
  const secs = pts.map((c, i) => {
    const T = pts[Math.min(i + 1, pts.length - 1)].clone().sub(pts[Math.max(i - 1, 0)]).normalize();
    const e1 = ref.clone().addScaledVector(T, -ref.dot(T)).normalize(), r = rs[i];
    return { c, e1, e2: T.clone().cross(e1), f: (t) => [r * Math.cos(t), r * Math.sin(t)] };
  });
  tube(B, stack(secs, M, rs[0] * 0.6, rs[rs.length - 1]), w);
}

// 관절 중심의 구: 회전해도 제자리라 굽힌 관절의 바깥쪽을 채운다
function ball(B, c, r, bone, M = 10, N = 6) {
  const rings = [[v3(c.x, c.y + r, c.z)]];
  for (let i = 1; i < N; i++) {
    const ph = (i / N) * Math.PI;
    rings.push(Array.from({ length: M }, (_, j) => { const t = (j / M) * Math.PI * 2; return v3(c.x + r * Math.sin(ph) * Math.cos(t), c.y + r * Math.cos(ph), c.z + r * Math.sin(ph) * Math.sin(t)); }));
  }
  rings.push([v3(c.x, c.y - r, c.z)]);
  tube(B, rings, [[bone, 1]]);
}

// ------------------------------------------------------------------ 몸통 + 목 (가로 단면, 아래→위)
const TORSO = table([
  // y, 반폭, 앞 깊이, 뒤 깊이, 중심 z, 단면 지수(클수록 각짐)
  [0.735, 0.04, 0.022, 0.03, -0.01, 2],
  [0.745, 0.08, 0.042, 0.058, -0.01, 2.1],
  [0.76, 0.125, 0.06, 0.086, -0.012, 2.2],
  [0.78, 0.152, 0.073, 0.102, -0.012, 2.3],
  [0.81, 0.166, 0.083, 0.107, -0.012, 2.3],
  [0.85, 0.17, 0.089, 0.104, -0.01, 2.3],
  [0.90, 0.16, 0.092, 0.095, -0.005, 2.3],
  [0.96, 0.144, 0.09, 0.086, 0, 2.2],
  [1.01, 0.137, 0.088, 0.085, 0, 2.2],
  [1.07, 0.142, 0.097, 0.09, 0, 2.3],
  [1.14, 0.150, 0.107, 0.097, 0.002, 2.4],
  [1.21, 0.157, 0.107, 0.10, 0, 2.4],
  [1.27, 0.163, 0.097, 0.097, -0.005, 2.4],
  [1.31, 0.168, 0.084, 0.087, -0.008, 2.4],
  [1.335, 0.16, 0.07, 0.077, -0.01, 2.3],
  [1.355, 0.138, 0.06, 0.066, -0.012, 2.2],
  [1.375, 0.106, 0.054, 0.058, -0.014, 2.1],
  [1.395, 0.075, 0.05, 0.054, -0.02, 2],
  [1.42, 0.058, 0.048, 0.052, -0.024, 2],
  [1.46, 0.054, 0.046, 0.05, -0.025, 2],
  [1.50, 0.048, 0.04, 0.045, -0.02, 2],
  [1.53, 0.03, 0.03, 0.03, -0.015, 2],
]);
const TY = [0.745, 0.756, 0.77, 0.79, 0.81, 0.835, 0.865, 0.895, 0.93, 0.97, 1.01, 1.05, 1.09, 1.13, 1.17, 1.21, 1.25, 1.28, 1.305, 1.325, 1.345, 1.365, 1.385, 1.41, 1.44, 1.47, 1.50];
// 근육 굴곡: 엉덩이, 가슴, 견갑골, 등 고랑
const torsoBump = (y, t) =>
  0.016 * gauss(y, 0.805, 0.04) * (gA(t, BACK - 0.55, 0.33) + gA(t, BACK + 0.55, 0.33)) - 0.007 * gauss(y, 0.8, 0.05) * gA(t, BACK, 0.1)
  + 0.008 * gauss(y, 1.185, 0.045) * (gA(t, FRONT - 0.55, 0.45) + gA(t, FRONT + 0.55, 0.45))
  + 0.007 * gauss(y, 1.24, 0.05) * (gA(t, BACK - 0.65, 0.35) + gA(t, BACK + 0.65, 0.35))
  - 0.004 * gA(t, BACK, 0.1) * smooth(0.92, 1.0, y) * smooth(1.33, 1.25, y);
const torsoW = (y) => {
  if (y < 1.2) { const k = smooth(0.89, 1.06, y); return [['下半身', 1 - k], ['上半身', k]]; }
  if (y < 1.415) { const k = smooth(1.35, 1.40, y); return [['上半身', 1 - k], ['首', k]]; }
  const k = smooth(1.43, 1.49, y); return [['首', 1 - k], ['頭', k]];
};
function torso(B) {
  B.mark('torso');
  const secs = TY.map((y) => {
    const [a, df, db, cz, p] = TORSO(y), e = 2 / p;
    return { c: v3(0, y, cz), e1: X, e2: Z, f: (t) => {
      const c = Math.cos(t), s = Math.sin(t), d = torsoBump(y, t);
      return [a * spow(c, e) + d * c, (s > 0 ? df : db) * spow(s, e) + d * s];
    } };
  });
  tube(B, stack(secs, 24, 0.012, 0.02), (p) => torsoW(p.y));
}

// ------------------------------------------------------------------ 머리: 달걀형 + 턱·뒤통수 (이목구비 없음)
function head(B) {
  B.mark('head');
  const HC = v3(0, 1.512, 0), M = 20, N = 14;
  const P = (ph, t) => {
    const x = Math.sin(ph) * Math.cos(t), y = Math.cos(ph), z = Math.sin(ph) * Math.sin(t), lo = Math.max(0, -y);
    const fr = smooth(-0.2, 0.6, z); // 0 뒤 → 1 앞
    const px = (y < 0 ? spow(x, 0.85) * (1 + 0.1 * lo) : x) * 0.075; // 턱은 목보다 넓게
    const py = y > 0 ? y * 0.108 : -(lo ** 0.85) * (0.086 + 0.028 * fr); // 턱은 앞쪽만 길고 둥글게, 뒤는 목으로 이어지게
    const pz = z > 0 ? spow(z, 0.75) * 0.094 // 얼굴 쪽은 평평하게
      : z * 0.104 * (1 + 0.05 * gauss(y, 0.1, 0.4)) * (1 - 0.32 * smooth(0.1, -0.9, y)); // 뒤통수 → 목덜미로 완만하게
    return v3(HC.x + px, HC.y + py, HC.z + pz + 0.012 * lo);
  };
  const rings = [[P(0, 0)]];
  for (let i = 1; i < N; i++) rings.push(Array.from({ length: M }, (_, j) => P((i / N) * Math.PI, (j / M) * Math.PI * 2)));
  rings.push([P(Math.PI, 0)]);
  tube(B, rings, [['頭', 1]]);
}

// ------------------------------------------------------------------ 팔 (어깨 관절부터 손목 너머까지, 왼쪽 기준)
const ARMT = table([
  // 어깨에서 거리, 손바닥 방향 반지름, 앞뒤 반지름, 손바닥 방향 보정(−: 바깥/위)
  [0.00, 0.049, 0.049, 0],
  [0.03, 0.049, 0.048, -0.003],
  [0.07, 0.047, 0.047, -0.003],
  [0.11, 0.044, 0.046, -0.002],
  [0.16, 0.042, 0.045, 0],
  [0.21, 0.040, 0.043, 0],
  [0.25, 0.037, 0.039, 0],
  [0.29, 0.035, 0.036, 0],
  [0.32, 0.037, 0.039, 0],
  [0.36, 0.038, 0.041, 0],
  [0.41, 0.033, 0.036, 0],
  [0.47, 0.026, 0.030, 0],
  [0.53, 0.019, 0.027, 0],
  [0.555, 0.016, 0.022, 0],
]);
const AS = [0, 0.03, 0.07, 0.11, 0.16, 0.21, 0.25, 0.275, 0.29, 0.305, 0.33, 0.36, 0.40, 0.44, 0.48, 0.51, 0.53, 0.555];
const armFrame = (pos) => {
  const J = pos['左腕'], W = pos['左手首'], a = W.clone().sub(J).normalize();
  return { J, W, a, n: v3(a.y, -a.x, 0) }; // n: 손바닥이 보는 방향 (아래·안쪽), 엄지는 +Z
};
function arm(B, S, pos) {
  const { J, a, n } = armFrame(pos);
  const ue = J.distanceTo(pos['左ひじ']), uw = J.distanceTo(pos['左手首']);
  const secs = AS.map((s) => {
    const [rn, rf, on] = ARMT(s);
    return { c: J.clone().addScaledVector(a, s).addScaledVector(n, on), e1: n, e2: Z, f: (t) => [rn * Math.cos(t), rf * Math.sin(t)] };
  });
  // 어깨 끝은 관절 중심의 반구 → 팔을 돌려도 어깨 모양 유지
  B.mark('arm' + S);
  tube(B, stack(secs, 12, 0.049, 0.012, 4), (p) => {
    const s = p.clone().sub(J).dot(a);
    if (s < 0.42) { const k = smooth(ue - 0.035, ue + 0.035, s); return [[S + '腕', 1 - k], [S + 'ひじ', k]]; }
    const k = smooth(uw - 0.03, uw + 0.01, s); return [[S + 'ひじ', 1 - k], [S + '手首', k]];
  });
  B.mark(null);
  ball(B, pos['左ひじ'], 0.032, S + 'ひじ', 10, 5);
}

// ------------------------------------------------------------------ 손: 손바닥 + 살짝 굽힌 네 손가락 + 엄지
const PALM = table([
  // 손목에서 거리, 반폭(엄지 방향), 반두께, 두께 방향 보정
  [0.000, 0.023, 0.016, 0],
  [0.015, 0.030, 0.016, 0.001],
  [0.040, 0.036, 0.0145, 0.001],
  [0.065, 0.039, 0.0125, 0],
  [0.085, 0.038, 0.011, -0.001],
]);
const FINGERS = [ // 엄지 쪽 위치, 손목에서 시작 거리, 길이 배율, 굵기
  [0.024, 0.084, 0.93, 0.009],
  [0.008, 0.087, 1, 0.0092],
  [-0.008, 0.084, 0.94, 0.0087],
  [-0.023, 0.077, 0.76, 0.0078],
];
function hand(B, S, pos) {
  const { W, a, n } = armFrame(pos), w = [[S + '手首', 1]];
  const P = (s, pn, pf) => W.clone().addScaledVector(a, s).addScaledVector(n, pn).addScaledVector(Z, pf);
  const secs = [0, 0.015, 0.04, 0.065, 0.085].map((s) => {
    const [hw, ht, on] = PALM(s);
    return { c: P(s, on, 0), e1: n, e2: Z, f: (t) => [ht * spow(Math.cos(t), 0.67), hw * spow(Math.sin(t), 0.67)] };
  });
  B.mark('palm' + S);
  tube(B, stack(secs, 12, 0.006, 0.01), w);
  B.mark(null);
  for (const [fo, sb, L, r] of FINGERS) {
    const pts = [P(sb - 0.012, -0.002, fo), P(sb, 0, fo)];
    let ang = 0;
    for (const [da, len] of [[0.12, 0.04], [0.33, 0.026], [0.35, 0.02]]) {
      ang += da;
      pts.push(pts[pts.length - 1].clone().addScaledVector(a, Math.cos(ang) * len * L).addScaledVector(n, Math.sin(ang) * len * L));
    }
    digit(B, pts, [r * 0.95, r, r * 0.95, r * 0.88, r * 0.8], Z, w);
  }
  // 엄지: 손바닥 옆(엄지두덩)에서 나와 검지 옆으로
  const tp = [P(0.016, 0.006, 0.013)];
  for (const [da, df, dn, len] of [[0.85, 0.45, 0.2, 0.032], [0.8, 0.2, 0.4, 0.026], [0.8, 0, 0.45, 0.02]]) {
    tp.push(tp[tp.length - 1].clone().addScaledVector(a.clone().multiplyScalar(da).addScaledVector(Z, df).addScaledVector(n, dn).normalize(), len));
  }
  digit(B, tp, [0.012, 0.0105, 0.0095, 0.0085], n, w, 7);
}

// ------------------------------------------------------------------ 다리 (가로 단면, 위→아래, 왼쪽 기준)
const LEG = table([
  // y, 중심 x 보정(바깥+), 중심 z, 바깥 반폭, 안쪽 반폭, 앞, 뒤
  [0.92, 0, 0, 0.03, 0.03, 0.03, 0.03],
  [0.90, 0, 0, 0.06, 0.055, 0.058, 0.06],
  [0.87, 0.002, 0, 0.078, 0.07, 0.075, 0.078],
  [0.83, 0.004, 0, 0.088, 0.08, 0.085, 0.086],
  [0.78, 0.004, 0.002, 0.086, 0.079, 0.082, 0.084],
  [0.70, 0.003, 0.004, 0.079, 0.074, 0.077, 0.077],
  [0.62, 0, 0.005, 0.071, 0.067, 0.069, 0.067],
  [0.54, -0.002, 0.004, 0.060, 0.060, 0.059, 0.056],
  [0.49, -0.003, 0.003, 0.053, 0.056, 0.054, 0.05],
  [0.455, -0.002, 0.003, 0.05, 0.051, 0.054, 0.047],
  [0.42, -0.001, 0, 0.047, 0.048, 0.046, 0.05],
  [0.38, 0, -0.004, 0.048, 0.05, 0.043, 0.058],
  [0.34, 0, -0.006, 0.05, 0.052, 0.041, 0.064],
  [0.29, 0, -0.006, 0.046, 0.048, 0.039, 0.058],
  [0.23, 0, -0.004, 0.039, 0.04, 0.035, 0.045],
  [0.17, 0, -0.003, 0.032, 0.032, 0.031, 0.035],
  [0.12, 0, -0.004, 0.029, 0.029, 0.029, 0.033],
  [0.09, 0, -0.006, 0.032, 0.033, 0.03, 0.034],
  [0.06, 0, -0.008, 0.026, 0.026, 0.025, 0.03],
  [0.045, 0, -0.01, 0.01, 0.01, 0.01, 0.01],
]);
const LY = [0.905, 0.88, 0.85, 0.82, 0.79, 0.75, 0.70, 0.64, 0.58, 0.53, 0.50, 0.475, 0.455, 0.435, 0.41, 0.38, 0.34, 0.30, 0.26, 0.22, 0.18, 0.145, 0.115, 0.09, 0.07, 0.055];
const legW = (S, y) => {
  if (y > 0.6) { const k = smooth(0.87, 0.72, y); return [['下半身', 1 - k], [S + '足', k]]; }
  if (y > 0.25) { const k = smooth(0.49, 0.425, y); return [[S + '足', 1 - k], [S + 'ひざ', k]]; }
  const k = smooth(0.13, 0.085, y); return [[S + 'ひざ', 1 - k], [S + '足首', k]];
};
function leg(B, S, pos) {
  const hip = pos['左足'];
  const secs = LY.map((y) => {
    const [cx, cz, wl, wm, df, db] = LEG(y), e = 2 / 2.1;
    return { c: v3(hip.x + cx, y, cz), e1: X, e2: Z, f: (t) => {
      const c = Math.cos(t), s = Math.sin(t);
      return [(c > 0 ? wl : wm) * spow(c, e), (s > 0 ? df : db) * spow(s, e) + 0.006 * gauss(y, 0.462, 0.016) * gA(t, FRONT, 0.5)]; // 무릎뼈
    } };
  });
  B.mark('leg' + S);
  tube(B, stack(secs, 14, 0.025, 0.012), (p) => legW(S, p.y));
  B.mark(null);
  ball(B, hip, 0.072, S + '足');
  ball(B, pos['左ひざ'], 0.043, S + 'ひざ');
}

// ------------------------------------------------------------------ 발: 뒤꿈치 → 발끝 (평평한 발바닥)
const FOOT = table([
  // 발목 기준 z, x 보정, 반폭, 바닥 y, 윗면 y
  [-0.06, 0, 0.026, 0.006, 0.05],
  [-0.045, 0, 0.031, 0, 0.07],
  [-0.015, 0, 0.034, 0, 0.088],
  [0.02, 0.002, 0.038, 0, 0.082],
  [0.06, 0.004, 0.042, 0, 0.068],
  [0.10, 0.004, 0.046, 0, 0.052],
  [0.13, 0.003, 0.046, 0, 0.043],
  [0.155, 0.002, 0.041, 0.001, 0.036],
  [0.175, 0, 0.032, 0.003, 0.03],
]);
function foot(B, S, pos) {
  const A = pos['左足首'];
  const secs = [-0.055, -0.04, -0.015, 0.02, 0.06, 0.10, 0.13, 0.155, 0.172].map((z) => {
    const [dx, hw, y0, y1] = FOOT(z), hh = (y1 - y0) / 2;
    return { c: v3(A.x + dx, (y0 + y1) / 2, A.z + z), e1: X, e2: Y, f: (t) => {
      const s = Math.sin(t);
      return [hw * spow(Math.cos(t), 0.8), hh * spow(s, s > 0 ? 0.9 : 0.45)];
    } };
  });
  B.mark('foot' + S);
  tube(B, stack(secs, 12, 0.012, 0.014), [[S + '足首', 1]]);
  B.mark(null);
}

// 서로 겹친 부품의 이음매: 상대 부품 표면에 가까운 정점은 법선을 상대 쪽과 섞어 경계선이 음영으로 드러나지 않게 한다
// (거리 = 가장 가까운 상대 정점의 접평면까지, k: 섞는 폭, 반경 2k 안의 정점만)
function blendSeams(geo, parts, pairs, k) {
  const P = geo.attributes.position, N = geo.attributes.normal, n0 = N.array.slice();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), na = new THREE.Vector3(), nb = new THREE.Vector3();
  const box = (R) => { const bb = new THREE.Box3(); for (let j = R.start; j < R.end; j++) bb.expandByPoint(b.fromBufferAttribute(P, j)); return bb.expandByScalar(k * 2); };
  const one = (A, R) => {
    const bb = box(R);
    for (let i = A.start; i < A.end; i++) {
      if (!bb.containsPoint(a.fromBufferAttribute(P, i))) continue;
      let best = -1, bd = 4 * k * k;
      for (let j = R.start; j < R.end; j++) { const d = a.distanceToSquared(b.fromBufferAttribute(P, j)); if (d < bd) { bd = d; best = j; } }
      if (best < 0) continue;
      nb.fromArray(n0, best * 3);
      const plane = Math.abs(b.fromBufferAttribute(P, best).sub(a).dot(nb));
      const w = 0.5 * smooth(k, 0, plane) * smooth(2 * k, k, Math.sqrt(bd));
      na.fromArray(n0, i * 3).lerp(nb, w).normalize();
      N.setXYZ(i, na.x, na.y, na.z);
    }
  };
  for (const [x, y] of pairs) { one(parts[x], parts[y]); one(parts[y], parts[x]); }
}

// ------------------------------------------------------------------ 조립
let geometry = null; // 모양은 모두 같고 색만 다르므로 한 번만 만든다
function buildGeometry(pos, boneIndex) {
  const B = new Builder(boneIndex);
  torso(B);
  head(B);
  for (const [S, sx] of [['左', 1], ['右', -1]]) {
    B.sx = sx;
    arm(B, S, pos); hand(B, S, pos); leg(B, S, pos); foot(B, S, pos);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(B.pos.map((v) => v * U), 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(B.si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(B.sw, 4));
  geo.setIndex(B.idx);
  geo.computeVertexNormals();
  const pairs = [['torso', 'head']];
  for (const S of ['左', '右']) pairs.push(['torso', 'arm' + S], ['torso', 'leg' + S], ['arm' + S, 'palm' + S], ['leg' + S, 'foot' + S]);
  blendSeams(geo, B.parts, pairs, 0.025 * U);
  geo.computeBoundingSphere();
  return geo;
}

function bodyMaterial(hex) {
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: 0.62, metalness: 0 });
  // 어두운 상영관에서도 실루엣이 읽히도록 아주 약한 자체광 + 가장자리광
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += diffuseColor.rgb * (0.05 + 0.28 * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0));`);
  };
  m.customProgramCacheKey = () => 'mannequin';
  return m;
}

export function buildProceduralBase(charId) {
  const pos = Object.fromEntries(BONES.map(([n, , x, y, z]) => [n, v3(x, y, z)]));
  const boneIndex = Object.fromEntries(BONES.map(([n], i) => [n, i]));
  geometry ||= buildGeometry(pos, boneIndex);

  // 뼈 (회전 없음, 부모 기준 위치)
  const bones = BONES.map(([n]) => { const b = new THREE.Bone(); b.name = n; return b; });
  BONES.forEach(([, parent, x, y, z], i) => {
    if (parent) {
      const p = pos[parent];
      bones[i].position.set((x - p.x) * U, (y - p.y) * U, (z - p.z) * U);
      bones[boneIndex[parent]].add(bones[i]);
    } else bones[i].position.set(x * U, y * U, z * U);
  });
  const mesh = new THREE.SkinnedMesh(geometry, bodyMaterial(BODY[charId] || BODY.yui));
  mesh.add(bones[0]);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  // 컬링용 경계구: 만세처럼 팔을 들어도 잘리지 않게 넉넉히
  mesh.boundingSphere = new THREE.Sphere(v3(0, 0.9 * U, 0), 1.25 * U);
  return { mesh, faceStates: null, faceMatIndex: -1, procedural: true };
}
