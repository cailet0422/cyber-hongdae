// 킹블레이드 스타일 응원봉: 시트지 도안(/assets/blade/sheet.png)을 투명 튜브에 말아 넣은 형태
import * as THREE from 'three';

let sheetTex = null;
function sheet() {
  if (!sheetTex) {
    sheetTex = new THREE.TextureLoader().load('/assets/blade/sheet.png');
    sheetTex.colorSpace = THREE.SRGBColorSpace;
    sheetTex.wrapS = THREE.RepeatWrapping;
    sheetTex.anisotropy = 4;
  }
  return sheetTex;
}

const LEN = 0.34;   // 발광부 길이(m)
const R = 0.019;    // 발광부 반지름
const GRIP = 0.13;

export function createLightstick() {
  const g = new THREE.Group();
  const color = new THREE.Color('#ff69b4');

  // 손잡이
  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 1.05, R * 0.95, GRIP, 16),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.5, metalness: 0.3 }),
  );
  grip.position.y = -GRIP / 2 + 0.03;
  g.add(grip);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.12, R * 1.12, 0.012, 16), new THREE.MeshStandardMaterial({ color: 0xb0b0b8, metalness: 0.9, roughness: 0.25 }));
  ring.position.y = 0.03;
  g.add(ring);
  const btn = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.02, 0.008), new THREE.MeshBasicMaterial({ color }));
  btn.position.set(0, -0.03, R * 1.02);
  g.add(btn);

  // 발광 튜브 (시트지 인쇄 = 어두운 부분)
  const bladeMat = new THREE.ShaderMaterial({
    uniforms: { uSheet: { value: sheet() }, uColor: { value: color }, uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform sampler2D uSheet; uniform vec3 uColor; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        vec3 s = texture2D(uSheet, vec2(vUv.x, vUv.y)).rgb;
        float ink = 1.0 - dot(s, vec3(0.333));
        float rim = pow(1.0 - abs(dot(vN, vV)), 1.5);
        vec3 glow = uColor * (1.6 + rim * 0.8);
        vec3 col = mix(glow, uColor * 0.08, smoothstep(0.35, 0.75, ink));
        col += vec3(1.0) * 0.35 * (1.0 - ink) * (1.0 - rim);
        gl_FragColor = vec4(col, 1.0);
      }`,
    toneMapped: false,
  });
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(R, R, LEN, 24, 1, false), bladeMat);
  blade.position.y = 0.036 + LEN / 2;
  g.add(blade);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(R, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  cap.position.y = 0.036 + LEN;
  g.add(cap);

  // 바깥 빛 번짐 (가산 혼합 프레넬 셸)
  const haloMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color } },
    vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(abs(dot(vN,vV)), 2.0); gl_FragColor = vec4(uColor * f * 0.55, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  const halo = new THREE.Mesh(new THREE.CapsuleGeometry(R * 3.2, LEN, 4, 16), haloMat);
  halo.position.y = blade.position.y;
  g.add(halo);

  g.userData.setColor = (hex) => {
    color.set(hex);
    btn.material.color.copy(color);
    cap.material.color.copy(color);
  };
  g.traverse((o) => { o.frustumCulled = false; });
  return g;
}
