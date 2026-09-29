(function () {
'use strict';
if (typeof THREE === 'undefined') {
  document.body.insertAdjacentHTML('beforeend', '<div class="err">3D 函式庫載入失敗，請檢查網路後重新整理頁面。</div>');
  return;
}
const $ = (id) => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches;
const lowPower = isTouch || Math.min(screen.width, screen.height) < 700;

// ---------------- Renderer / scene ----------------
const canvas = $('gl');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });   // 多重取樣抗鋸齒（MSAA）：Apple GPU 在晶片內做，成本很低
} catch (e) {
  document.body.insertAdjacentHTML('beforeend', '<div class="err">這個瀏覽器無法啟用 WebGL，請改用較新的瀏覽器。</div>');
  return;
}
// 解析度：一開始用裝置能給的（最高 2 倍），如果實際幀率掉到約 48 fps 以下才逐步降低
const DPR_NATIVE = Math.min(devicePixelRatio || 1, 3), DPR_MIN = Math.min(DPR_NATIVE, 1.25);
let dpr = Math.min(DPR_NATIVE, 2), dprCeil = DPR_NATIVE, qualityMode = 'auto';
renderer.setPixelRatio(dpr);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 14000);

const SUN_AZ = 148 * D2R, SUN_EL = 30 * D2R;
const sunDir = new THREE.Vector3(Math.sin(SUN_AZ) * Math.cos(SUN_EL), Math.sin(SUN_EL), -Math.cos(SUN_AZ) * Math.cos(SUN_EL)).normalize();

const PALETTES = {
  calm:     { zen: [0.16, 0.42, 0.86], hor: [0.70, 0.83, 0.95], sun: [1.0, 0.93, 0.8], deep: [0.02, 0.17, 0.40], sss: [0.04, 0.46, 0.62], fog: 0.00036, light: 1.05, cloud: 0.64 },
  moderate: { zen: [0.20, 0.44, 0.80], hor: [0.72, 0.82, 0.92], sun: [1.0, 0.92, 0.78], deep: [0.02, 0.16, 0.37], sss: [0.05, 0.44, 0.60], fog: 0.00042, light: 1.0, cloud: 0.52 },
  rough:    { zen: [0.36, 0.44, 0.54], hor: [0.66, 0.70, 0.74], sun: [0.75, 0.74, 0.70], deep: [0.03, 0.11, 0.18], sss: [0.06, 0.26, 0.30], fog: 0.00058, light: 0.78, cloud: 0.4 },
  storm:    { zen: [0.20, 0.23, 0.27], hor: [0.40, 0.43, 0.46], sun: [0.42, 0.42, 0.43], deep: [0.015, 0.06, 0.085], sss: [0.04, 0.15, 0.16], fog: 0.00115, light: 0.42, cloud: 0.18, rain: 1 }
};
const U = {
  uTime: { value: 0 }, uSunDir: { value: sunDir }, uSunCol: { value: new THREE.Color() },
  uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
  uDeep: { value: new THREE.Color() }, uSss: { value: new THREE.Color() },
  uFogD: { value: 0.0004 }, uCamPos: { value: new THREE.Vector3() },
  uW: { value: [] }, uW2: { value: [] }, uChop: { value: 1 }, uWindAng: { value: 0 },
  uDepth: { value: null }, uBox: { value: new THREE.Vector4() },
  uNormTex: { value: null }, uFoamTex: { value: null }, uFoamJ: { value: 0.85 },
  uTrail: { value: [] }, uBoat: { value: new THREE.Vector4() },
  uShadowOff: { value: new THREE.Vector2() }, uSailSh: { value: new THREE.Vector4() },
  uGust: { value: new THREE.Vector3(0, 1, 6) }, uCloudCov: { value: 0.55 }, uCloudOff: { value: new THREE.Vector2() },
  uHaze: { value: 0.0004 }, uLight: { value: 1 }, uHullC: { value: new THREE.Vector4(0.52, 3.65, 1, 0) }, uHullS: { value: new THREE.Vector4(2.7, 0.2, 2.45, 0) }, uBeams: { value: new THREE.Vector3(-1.35, 1.45, 2.8) }, uFloatImm: { value: new THREE.Vector3(0, 0, 0) }, uRain: { value: 0 }, uCloudTex: { value: null }, uCirrus: { value: 0.4 }, uCirrusRot: { value: new THREE.Vector2(1, 0) }, uFoamMap: { value: null }, uFoamC: { value: new THREE.Vector3(0, 0, 256) }, uFoamD: { value: new THREE.Vector2() }
};
for (let i = 0; i < 6; i++) { U.uW.value.push(new THREE.Vector4()); U.uW2.value.push(new THREE.Vector4()); }
const TRAIL_N = 20;
for (let i = 0; i < TRAIL_N; i++) U.uTrail.value.push(new THREE.Vector4(0, 0, 99, 0));
scene.fog = new THREE.FogExp2(0xbfd3e6, 0.0004);

const SKY_GLSL = `
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uZenith; uniform vec3 uHorizon;
vec3 skyCol(vec3 d) {
  float y = max(d.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(y, 0.5));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunCol * (smoothstep(0.99985, 0.99996, sd) * 10.0 + pow(sd, 900.0) * 0.28 + pow(sd, 60.0) * 0.1 + pow(sd, 6.0) * 0.07);   // 真實大小的日輪（約 1°）＋由內而外的光暈
  col += uSunCol * pow(sd, 3.0) * 0.07 * (1.0 - y);                 // 貼近地平線的柔和光暈（前向散射）
  if (d.y < 0.0) col = mix(uHorizon, uHorizon * 0.82, clamp(-d.y * 4.0, 0.0, 1.0));
  return col;
}`;

const NOISE_GLSL = `
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
uniform float uCloudCov; uniform vec2 uCloudOff; uniform sampler2D uCloudTex;
// 雲影：預先烘焙成可無縫拼接的雜訊貼圖（每 4 公里重複一次），一次取樣取代三層即時雜訊
float cloudShade(vec2 p) {
  vec2 pc = p + uSunDir.xz / max(uSunDir.y, 0.1) * 1500.0;       // 影子來自 1500 m 高的雲，沿太陽方向回推
  float n = texture2D(uCloudTex, (pc / 520.0 + uCloudOff) / 8.0).r;
  return smoothstep(uCloudCov, uCloudCov + 0.16, n);
}
// 天空中的雲層：和雲影用同一張貼圖、同一個高度，所以天上的雲、海面上的倒影、海面和山上的雲影三者對得上
uniform float uCirrus; uniform vec2 uCirrusRot;
float cdens(vec2 q) {
  float base = texture2D(uCloudTex, q).r;
  float det = texture2D(uCloudTex, q * 4.3 + vec2(0.37, 0.71)).g;
  return smoothstep(uCloudCov - 0.04, uCloudCov + 0.24, base - (1.0 - det) * 0.08);   // 細胞雜訊把邊緣啃成棉絮狀
}
float hgPhase(float c, float g) { float g2 = g * g; return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5) * 0.0796; }
// 積雲：往太陽方向在雲層裡走幾步，累積擋光的厚度（比爾定律）→ 背光面暗、迎光面亮；
// 前向散射讓靠近太陽的雲邊發亮，「粉末效應」讓稀薄處不會過亮
vec4 cumulus(vec3 d, vec3 o, float hq) {
  if (d.y < 0.01) return vec4(0.0);
  float t = (1500.0 - o.y) / d.y;
  vec2 q = ((o.xz + d.xz * t) / 520.0 + uCloudOff) / 8.0;
  float dens = cdens(q);
  if (dens < 0.004) return vec4(0.0);
  vec2 st = normalize(uSunDir.xz + 1e-4) * 0.0032;
  float od = cdens(q + st);
  if (hq > 0.5) od += cdens(q + st * 2.3) + cdens(q + st * 3.9); else od *= 2.7;
  float trans = exp(-od * 0.8);
  float c = dot(d, uSunDir);
  float fwd = hgPhase(c, 0.65) * 4.0;                                        // 前向散射：朝太陽看時雲邊發亮
  float sunI = clamp(length(uSunCol) / 1.65, 0.15, 1.0);
  vec3 white = mix(vec3(0.97, 0.97, 0.96), uSunCol * 0.62, 0.25);
  vec3 grey = mix(vec3(0.74, 0.77, 0.83), uZenith * 0.7 + 0.3, 0.3);         // 雲底被天空的藍光照著
  float side = 1.0 - smoothstep(0.08, 0.55, d.y);                            // 低角度看到的是雲的側面，比較亮；頭頂上看到的是雲底
  vec3 col = mix(grey, white, clamp(0.5 + 0.5 * trans + side * 0.25, 0.0, 1.0) * mix(0.6, 1.0, sunI));
  col *= 1.0 - 0.16 * dens * dens * (1.0 - trans) * (1.0 - side);              // 厚的雲心略暗
  col += uSunCol * fwd * (1.0 - dens * 0.65) * trans * sunI;                   // 薄的雲邊透出銀邊
  col *= mix(0.55, 1.0, sunI);
  col = mix(col, uHorizon * 1.02, smoothstep(3500.0, 26000.0, t) * 0.7);           // 遠方的雲被大氣染成地平線的顏色
  return vec4(col, dens * smoothstep(0.01, 0.1, d.y));
}
// 高空卷雲：約 6500 m，沿風向拉長的細絲，薄而透光
vec4 cirrus(vec3 d, vec3 o) {
  if (uCirrus <= 0.0 || d.y < 0.02) return vec4(0.0);
  float t = (6500.0 - o.y) / d.y;
  vec2 q = ((o.xz + d.xz * t) / 2600.0 + uCloudOff * 0.35) / 8.0;
  q = vec2(q.x * uCirrusRot.x - q.y * uCirrusRot.y, q.x * uCirrusRot.y + q.y * uCirrusRot.x);
  float a = smoothstep(0.5, 0.88, texture2D(uCloudTex, q).b) * uCirrus * smoothstep(0.02, 0.2, d.y);
  vec3 col = mix(uZenith, vec3(1.0), 0.72) * (0.85 + 0.5 * pow(max(dot(d, uSunDir), 0.0), 5.0));
  return vec4(col, a * 0.5);
}
vec3 skyFull(vec3 d, vec3 o, float hq) {
  vec3 s = skyCol(d);
  vec4 ci = cirrus(d, o); s = mix(s, ci.rgb, ci.a);
  vec4 cu = cumulus(d, o, hq); return mix(s, cu.rgb, cu.a);
}`;
// 雲的貼圖（256×256，可無縫拼接）
// R：雲的形狀＝值雜訊 × Worley 細胞雜訊（像積雲一團團鼓起來）；再依排序對應回原本雜訊的分布，讓各海況的雲量不變
// G：高頻細胞雜訊，用來把雲邊「啃」出細碎的棉絮感；B：拉長的條紋雜訊，給高空卷雲用
{
  const N = 256, d = new Uint8Array(N * N * 4);
  const R0 = rnd(101);
  const lattice = (P, s) => { const R = rnd(s), g = new Float32Array(P * P); for (let k = 0; k < P * P; k++) g[k] = R(); return g; };
  const vnoiseP = (g, Px, Py, x, y) => {       // 週期性值雜訊，x,y ∈ [0,1)
    const fx = x * Px, fy = y * Py, xi = Math.floor(fx), yi = Math.floor(fy), u = fx - xi, w = fy - yi;
    const su = u * u * (3 - 2 * u), sw = w * w * (3 - 2 * w), at = (i, j) => g[(j % Py) * Px + (i % Px)];
    return lerp(lerp(at(xi, yi), at(xi + 1, yi), su), lerp(at(xi, yi + 1), at(xi + 1, yi + 1), su), sw);
  };
  const cellPts = (P, s) => { const R = rnd(s), pts = new Float32Array(P * P * 2); for (let k = 0; k < P * P * 2; k++) pts[k] = R(); return pts; };
  const worley = (pts, P, x, y) => {            // 週期性 Worley F1，回傳 0（在點上）~1
    const fx = x * P, fy = y * P, xi = Math.floor(fx), yi = Math.floor(fy);
    let best = 9;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = xi + i, cy = yi + j, k = ((((cy % P) + P) % P) * P + (((cx % P) + P) % P)) * 2;
      const dx = cx + pts[k] - fx, dy = cy + pts[k + 1] - fy, dd = dx * dx + dy * dy;
      if (dd < best) best = dd;
    }
    return Math.min(1, Math.sqrt(best));
  };
  const oldOct = [[8, 0.6], [16, 0.3], [32, 0.1]].map(([P, a], i) => ({ P, a, g: lattice(P, 101 + i * 13) }));
  const valOct = [[4, 0.5], [8, 0.3], [16, 0.15], [32, 0.05]].map(([P, a], i) => ({ P, a, g: lattice(P, 211 + i * 7) }));
  const w8 = cellPts(8, 5), w16 = cellPts(16, 6), w32 = cellPts(32, 7), w64 = cellPts(64, 8);
  const cir = [[2, 16, 0.55], [4, 32, 0.3], [8, 64, 0.15]].map(([px, py, a], i) => ({ px, py, a, g: lattice(px * py, 307 + i * 11) }));
  const shape = new Float32Array(N * N), old = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, k = y * N + x;
    let o = 0; for (const q of oldOct) o += vnoiseP(q.g, q.P, q.P, u, v) * q.a; old[k] = o;
    let val = 0; for (const q of valOct) val += vnoiseP(q.g, q.P, q.P, u, v) * q.a;
    const wf = 1 - (worley(w8, 8, u, v) * 0.7 + worley(w16, 16, u, v) * 0.25 + worley(w32, 32, u, v) * 0.05);
    shape[k] = val * 0.55 + wf * 0.62;                                   // 雜訊決定分布、細胞讓輪廓鼓起來
    const det = 1 - (worley(w32, 32, u * 2 % 1, v * 2 % 1) * 0.55 + worley(w64, 64, u, v) * 0.45);
    let c = 0; for (const q of cir) c += vnoiseP(q.g, q.px, q.py, u, v) * q.a;
    d[k * 4 + 1] = clamp(det, 0, 1) * 255; d[k * 4 + 2] = clamp(c, 0, 1) * 255; d[k * 4 + 3] = 255;
  }
  // 依排序把新形狀對應到舊雜訊的數值分布：雲量門檻（各海況的 uCloudCov）意義維持不變
  const idx = Array.from({ length: N * N }, (_, i) => i).sort((a, b) => shape[a] - shape[b]);
  const oldSorted = Float32Array.from(old).sort();
  for (let r = 0; r < idx.length; r++) d[idx[r] * 4] = oldSorted[r] * 255;
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  U.uCloudTex.value = t;
}

// ---------------- Sky ----------------
const skyMat = new THREE.ShaderMaterial({
  uniforms: U, side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
  fragmentShader: SKY_GLSL + NOISE_GLSL + `uniform vec3 uCamPos; varying vec3 vDir; void main(){ gl_FragColor = vec4(skyFull(normalize(vDir), uCamPos, 1.0), 1.0); }`
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(10000, 32, 16), skyMat);
sky.renderOrder = 50; sky.frustumCulled = false; skyMat.depthFunc = THREE.LessEqualDepth;  // 最後才畫，被海和山擋住的像素直接略過
scene.add(sky);

// ---------------- Lights ----------------
const sunLight = new THREE.DirectionalLight(0xfff1dc, 1.0);
sunLight.position.copy(sunDir).multiplyScalar(100);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(lowPower ? 1024 : 2048, lowPower ? 1024 : 2048);
Object.assign(sunLight.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 120 });
sunLight.shadow.bias = -0.0004; sunLight.shadow.normalBias = 0.03;
scene.add(sunLight); scene.add(sunLight.target);
const hemi = new THREE.HemisphereLight(0xcfe2f5, 0x3a4a3a, 0.62);
scene.add(hemi);

// ---------------- Canvas textures ----------------
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}
function rnd(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
const woodTex = canvasTex(256, 256, (g, w, h) => {
  const R = rnd(11);
  g.fillStyle = '#6b4a2e'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 8; i++) {
    const y = i * h / 8; g.fillStyle = `hsl(28, ${35 + R() * 15}%, ${22 + R() * 10}%)`; g.fillRect(0, y, w, h / 8 - 2);
    g.strokeStyle = 'rgba(0,0,0,.18)';
    for (let k = 0; k < 14; k++) { g.beginPath(); const yy = y + R() * h / 8; g.moveTo(0, yy); g.bezierCurveTo(w * .3, yy + R() * 4 - 2, w * .6, yy + R() * 4 - 2, w, yy); g.stroke(); }
    g.fillStyle = 'rgba(20,10,5,.6)'; g.fillRect(0, y + h / 8 - 2, w, 2);
  }
}, true);
const sailTex = canvasTex(256, 256, (g, w, h) => {
  const R = rnd(5);
  g.fillStyle = '#c8b27f'; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 8) for (let y = 0; y < h; y += 8) {
    const odd = ((x + y) / 8) % 2;
    g.fillStyle = odd ? `rgba(120,90,40,${0.12 + R() * 0.08})` : `rgba(255,240,200,${0.08 + R() * 0.06})`;
    g.fillRect(x, y, 8, 8);
  }
  g.strokeStyle = 'rgba(90,60,25,.55)'; g.lineWidth = 2;
  for (let x = 0; x < w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
}, true);
const puffTex = canvasTex(128, 128, (g, w, h) => {
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
const cloudTex = canvasTex(512, 256, (g, w, h) => {
  const R = rnd(21);
  for (let i = 0; i < 42; i++) {
    const x = w * 0.12 + R() * w * 0.76, y = h * 0.4 + R() * h * 0.35 - Math.abs(x - w / 2) / w * 40;
    const r = 26 + R() * 60;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const sh = 0.86 + R() * 0.14;
    gr.addColorStop(0, `rgba(${255 * sh | 0},${255 * sh | 0},${255 * sh | 0},.55)`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
});

// ---------------- Terrain ----------------
const BOX = { x: -900, z: -900, w: 2600, h: 2700, res: 6.5 };
const DW = Math.round(BOX.w / BOX.res), DH = Math.round(BOX.h / BOX.res);
const depthData = new Uint8Array(DW * DH * 4);
for (let j = 0; j < DH; j++) for (let i = 0; i < DW; i++) {
  const h = terrainHeight(BOX.x + (i + 0.5) * BOX.res, BOX.z + (j + 0.5) * BOX.res);
  const v = Math.round(clamp((h + 40) / 80, 0, 1) * 255);
  const o = (j * DW + i) * 4; depthData[o] = v; depthData[o + 1] = v; depthData[o + 2] = v; depthData[o + 3] = 255;
}
const depthTex = new THREE.DataTexture(depthData, DW, DH, THREE.RGBAFormat);
depthTex.magFilter = THREE.LinearFilter; depthTex.minFilter = THREE.LinearFilter; depthTex.needsUpdate = true;
U.uDepth.value = depthTex; U.uBox.value.set(BOX.x, BOX.z, BOX.w, BOX.h);

// 地形著色器：依坡度、高度與雜訊混合森林、草地、岩壁、礫石灘；
// 烘焙的太陽陰影與環境遮蔽、飄移的雲影、隨距離加深的大氣透視
const terrainMat = new THREE.ShaderMaterial({
  uniforms: U, fog: false,
  vertexShader: `attribute vec2 aShade; varying vec3 vW; varying vec3 vNrm; varying vec2 vS;
    void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vNrm = normal; vS = aShade; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: SKY_GLSL + NOISE_GLSL + `
uniform vec3 uCamPos; uniform float uFogD; uniform float uLight;
varying vec3 vW; varying vec3 vNrm; varying vec2 vS;
void main() {
  vec3 N = normalize(vNrm), p = vW;
  float n1 = vn(p.xz * 0.009), n2 = vn(p.xz * 0.05 + 3.1), n3 = vn(p.xz * 0.21 + 7.7), n4 = vn(p.xz * 0.9 + 1.3);
  float slope = 1.0 - N.y, h = p.y;
  // 植被：闊葉林為主，低處緩坡夾雜草地，高山轉為偏藍的暗綠
  vec3 forest = mix(vec3(0.075, 0.19, 0.07), vec3(0.15, 0.27, 0.10), n2 * 0.7 + n3 * 0.3);
  vec3 grass = mix(vec3(0.33, 0.42, 0.17), vec3(0.42, 0.45, 0.22), n3);
  vec3 veg = mix(forest, grass, smoothstep(0.6, 0.8, n1 + slope * 0.3) * (1.0 - smoothstep(50.0, 150.0, h)));
  veg = mix(veg, vec3(0.11, 0.20, 0.13), smoothstep(250.0, 650.0, h));
  veg *= 0.6 + 0.3 * n3 + 0.22 * n2 + 0.12 * n4;   // 樹冠的明暗斑駁
  // 岩壁與東海岸常見的灰色礫石灘
  vec3 rock = mix(vec3(0.34, 0.32, 0.29), vec3(0.52, 0.49, 0.44), n3) * (0.78 + 0.36 * n4);
  vec3 sand = mix(vec3(0.60, 0.57, 0.50), vec3(0.47, 0.45, 0.42), n2 * 0.6 + n4 * 0.4);
  float rockM = smoothstep(0.40, 0.60, slope + (n2 - 0.5) * 0.25);
  float beachM = (1.0 - smoothstep(2.2, 5.5, h + (n3 - 0.5) * 3.0)) * (1.0 - smoothstep(0.35, 0.6, slope));
  rockM = max(rockM, (1.0 - smoothstep(0.5, 3.0, h)) * (1.0 - beachM) * 0.8);
  vec3 alb = mix(veg, rock, rockM);
  alb = mix(alb, sand, beachM);
  alb *= mix(0.55, 1.0, smoothstep(-0.3, 1.0, h));          // 水線附近被浪打濕而變暗
  // 光照：烘焙陰影 × 飄移雲影，天空與地面反射的環境光乘上環境遮蔽
  float cs = cloudShade(p.xz);
  float sunV = vS.x * (1.0 - 0.62 * cs);
  float nl = dot(N, uSunDir);
  float diff = mix(max(nl, 0.0), clamp(nl * 0.5 + 0.5, 0.0, 1.0) * 0.7, 0.14);
  vec3 amb = mix(uHorizon * 0.42 + vec3(0.02, 0.03, 0.02), uZenith * 0.85, N.y * 0.5 + 0.5) * vS.y;
  vec3 col = alb * (uSunCol * diff * sunV * uLight * 1.4 + amb * 0.52);
  // 大氣透視：越遠越接近天色，高處空氣較稀薄、霧較淡
  vec3 V = p - uCamPos; float dist = length(V);
  float dens = uFogD * (1.0 - 0.45 * smoothstep(0.0, 700.0, h));
  float haze = 1.0 - exp(-pow(dens * dist, 1.55));
  vec3 hc = skyCol(normalize(vec3(V.x, 0.035 * length(V.xz), V.z)));
  gl_FragColor = vec4(mix(col, hc * 0.97, haze), 1.0);
}`
});

// 以網格建地形：同時算法線、太陽可見度（沿太陽方向在網格上步進）與環境遮蔽
function buildTerrain(x0, z0, x1, z1, nx, nz) {
  const W = nx + 1, Hh = nz + 1, dx = (x1 - x0) / nx, dz = (z1 - z0) / nz;
  const H = new Float32Array(W * Hh);
  let hmax = -Infinity;
  for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
    const h = Math.max(-14, terrainFull(x0 + i * dx, z0 + j * dz));
    H[j * W + i] = h; if (h > hmax) hmax = h;
  }
  if (hmax < -2) return null;
  const at = (i, j) => H[clamp(j, 0, nz) * W + clamp(i, 0, nx)];
  const sample = (x, z) => {
    const fi = (x - x0) / dx, fj = (z - z0) / dz;
    if (fi < 0 || fj < 0 || fi >= nx || fj >= nz) return -40;
    const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
    return lerp(lerp(at(i, j), at(i + 1, j), u), lerp(at(i, j + 1), at(i + 1, j + 1), u), v);
  };
  const pos = new Float32Array(W * Hh * 3), nrm = new Float32Array(W * Hh * 3), shade = new Float32Array(W * Hh * 2);
  const sl = Math.hypot(sunDir.x, sunDir.z), sx = sunDir.x / sl, sz = sunDir.z / sl, tanE = sunDir.y / sl;
  const step = Math.min(dx, dz) * 1.3;
  const aoR1 = Math.max(2, Math.round(18 / dx)), aoR2 = Math.max(4, Math.round(60 / dx));
  for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i, h = H[k], x = x0 + i * dx, z = z0 + j * dz;
    pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
    const gx = (at(i + 1, j) - at(i - 1, j)) / (2 * dx), gz = (at(i, j + 1) - at(i, j - 1)) / (2 * dz);
    const il = 1 / Math.hypot(gx, 1, gz);
    nrm[k * 3] = -gx * il; nrm[k * 3 + 1] = il; nrm[k * 3 + 2] = -gz * il;
    // 軟陰影：沿太陽方向步進，看地形有沒有擋住光線，擋得越多越暗
    let vis = 1;
    if (h > -3) {
      for (let d = step; d < 900; d += step * (1 + d / 300)) {
        const ray = h + d * tanE;
        if (ray > hmax) break;
        const th = sample(x + sx * d, z + sz * d);
        vis = Math.min(vis, clamp(1 - (th - ray) / (4 + d * 0.06), 0, 1));
        if (vis <= 0) break;
      }
    }
    // 環境遮蔽：比周圍低的地方（山谷、凹處）比較暗
    const a1 = (at(i + aoR1, j) + at(i - aoR1, j) + at(i, j + aoR1) + at(i, j - aoR1)) * 0.25;
    const a2 = (at(i + aoR2, j) + at(i - aoR2, j) + at(i, j + aoR2) + at(i, j - aoR2)) * 0.25;
    const ao = clamp(1 - Math.max(0, a1 - h) / 22 - Math.max(0, a2 - h) / 90, 0.35, 1);
    shade[k * 2] = vis; shade[k * 2 + 1] = ao;
  }
  const idx = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
    if (H[a] < -12 && H[b] < -12 && H[c] < -12 && H[d] < -12) continue;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('aShade', new THREE.BufferAttribute(shade, 2));
  geo.setIndex(W * Hh > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  const mesh = new THREE.Mesh(geo, terrainMat);
  scene.add(mesh);
  return mesh;
}
// 臺灣：近景（海岸山脈，高解析）＋遠景（花東縱谷與中央山脈，低解析）
buildTerrain(-1120, -2300, -30, 2700, lowPower ? 104 : 180, lowPower ? 340 : 620);
buildTerrain(-6200, -7000, -1080, 7500, lowPower ? 60 : 90, lowPower ? 130 : 200);
for (const is of WORLD.islands) {
  const s = is.r * 2.3, n = is.r > 60 ? (lowPower ? 90 : 140) : is.r > 30 ? (lowPower ? 70 : 110) : 30;
  buildTerrain(is.x - s, is.z - s, is.x + s, is.z + s, n, n);
}

// ---------------- Ocean ----------------
function oceanGeometry(rings, segs) {
  const pos = [0, 0, 0]; const idx = [];
  const radii = [];
  const g = Math.pow(1500 / 1.2 + 1, 1 / rings);
  for (let i = 1; i <= rings; i++) radii.push(1.2 * (Math.pow(g, i) - 1));
  radii.push(3500, 9000);
  for (const r of radii) for (let j = 0; j < segs; j++) { const a = j / segs * TAU; pos.push(Math.cos(a) * r, 0, Math.sin(a) * r); }
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 0; i < radii.length - 1; i++) {
    const a0 = 1 + i * segs, a1 = 1 + (i + 1) * segs;
    for (let j = 0; j < segs; j++) { const j1 = (j + 1) % segs; idx.push(a0 + j, a0 + j1, a1 + j, a0 + j1, a1 + j1, a1 + j); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}
// 可無縫拼接的細波紋法線貼圖：以多個整數波數的正弦疊加（類似海浪頻譜），順風方向較強
function rippleTexture(N, seed) {
  const R = rnd(seed), h = new Float32Array(N * N), comps = [];
  while (comps.length < 170) {
    const kx = Math.round((R() * 2 - 1) * 26), ky = Math.round((R() * 2 - 1) * 26);
    const k = Math.hypot(kx, ky); if (k < 2 || k > 26) continue;
    const al = kx / k; const dirW = al > 0 ? 0.3 + 0.7 * al * al : 0.3 + 0.25 * al * al;
    comps.push([TAU * kx / N, TAU * ky / N, Math.pow(k, -1.25) * dirW * (0.6 + R() * 0.8), R() * TAU]);
  }
  const cx = new Float32Array(N);
  for (const [kx, ky, a, ph] of comps) {
    for (let x = 0; x < N; x++) cx[x] = kx * x + ph;
    for (let y = 0; y < N; y++) { const oy = ky * y, row = y * N; for (let x = 0; x < N; x++) h[row + x] += a * Math.cos(cx[x] + oy); }
  }
  const gx = new Float32Array(N * N), gy = new Float32Array(N * N); let rms = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    gx[i] = (h[y * N + ((x + 1) % N)] - h[y * N + ((x + N - 1) % N)]) * 0.5;
    gy[i] = (h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x]) * 0.5;
    rms += gx[i] * gx[i] + gy[i] * gy[i];
  }
  rms = Math.sqrt(rms / (N * N * 2)) || 1;
  const d = new Uint8Array(N * N * 4);
  let hmin = Infinity, hmax = -Infinity; for (const v of h) { if (v < hmin) hmin = v; if (v > hmax) hmax = v; }
  for (let i = 0; i < N * N; i++) {
    d[i * 4] = clamp(128 + gx[i] / rms * 32, 0, 255); d[i * 4 + 1] = clamp(128 + gy[i] / rms * 32, 0, 255);
    d[i * 4 + 2] = (h[i] - hmin) / (hmax - hmin) * 255; d[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}
// 泡沫紋理：週期性脊狀雜訊，形成破碎、牽絲的白沫
function foamTexture(N, seed) {
  const d = new Uint8Array(N * N * 4);
  const lat = (P, s) => { const g = new Float32Array(P * P); const R = rnd(s); for (let i = 0; i < P * P; i++) g[i] = R(); return g; };
  const octs = [[8, 0.5], [16, 0.28], [32, 0.15], [64, 0.07]].map(([P, a], i) => ({ P, a, g: lat(P, seed + i * 17) }));
  const sample = (o, u, v) => {
    const x = u * o.P, y = v * o.P, xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf), P = o.P;
    const g = (i, j) => o.g[((j % P + P) % P) * P + ((i % P + P) % P)];
    return lerp(lerp(g(xi, yi), g(xi + 1, yi), sx), lerp(g(xi, yi + 1), g(xi + 1, yi + 1), sx), sy);
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0; for (const o of octs) v += (1 - Math.abs(sample(o, x / N, y / N) * 2 - 1)) * o.a;
    const i = (y * N + x) * 4; d[i] = d[i + 1] = d[i + 2] = clamp(v * 255, 0, 255); d[i + 3] = 255;
  }
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}
U.uNormTex.value = rippleTexture(128, 42);
U.uFoamTex.value = foamTexture(128, 7);

const oceanMat = new THREE.ShaderMaterial({
  uniforms: U, side: THREE.DoubleSide, fog: false,
  vertexShader: `
uniform float uTime; uniform vec4 uW[6]; uniform vec4 uW2[6]; uniform vec3 uCamPos;
varying vec3 vPos; varying vec3 vN; varying float vJac; varying float vH; varying vec2 vBase;
void main() {
  vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
  vec2 xz = p.xz; vBase = xz;
  float dist = length(xz - uCamPos.xz);
  vec3 disp = vec3(0.0); float nx = 0.0, nz = 0.0, ny = 0.0, jxx = 0.0, jzz = 0.0, jxz = 0.0;
  for (int i = 0; i < 6; i++) {
    vec4 a = uW[i]; vec4 b = uW2[i];
    float fade = 1.0 - smoothstep(b.w * 7.0, b.w * 18.0, dist);
    float amp = a.w * fade;
    float f = a.z * (dot(a.xy, xz) - b.x * uTime) + b.z;
    float c = cos(f), s = sin(f);
    float qa = b.y * amp;
    disp.x += a.x * qa * c; disp.z += a.y * qa * c; disp.y += amp * s;
    float wa = a.z * amp, wqs = b.y * wa * s;
    nx += a.x * wa * c; nz += a.y * wa * c; ny += wqs;
    jxx += a.x * a.x * wqs; jzz += a.y * a.y * wqs; jxz += a.x * a.y * wqs;
  }
  p += disp;
  vN = vec3(-nx, 1.0 - ny, -nz);
  vJac = (1.0 - jxx) * (1.0 - jzz) - jxz * jxz;
  vH = disp.y; vPos = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`,
  fragmentShader: SKY_GLSL + NOISE_GLSL + `
uniform float uTime; uniform vec3 uCamPos; uniform vec3 uDeep; uniform vec3 uSss; uniform float uFogD;
uniform float uChop; uniform float uWindAng; uniform sampler2D uDepth; uniform vec4 uBox;
uniform sampler2D uNormTex; uniform sampler2D uFoamTex; uniform float uFoamJ;
uniform vec4 uTrail[${TRAIL_N}]; uniform vec4 uBoat; uniform vec2 uShadowOff; uniform vec4 uSailSh;
uniform vec3 uGust; uniform vec3 uFloatImm; uniform float uRain; uniform float uLight; uniform vec4 uHullC; uniform vec4 uHullS; uniform vec3 uBeams;
uniform sampler2D uFoamMap; uniform vec3 uFoamC; uniform vec2 uFoamD;
varying vec3 vPos; varying vec3 vN; varying float vJac; varying float vH; varying vec2 vBase;
float gustF(vec2 p) {
  vec2 q = p - uGust.xy * uGust.z * uTime;
  return sin(q.x * 0.0131 + q.y * 0.0047 + 1.3) * sin(q.x * -0.0051 + q.y * 0.0117 + 0.4) * 0.7 + sin(q.x * 0.0213 - q.y * 0.0161 + 2.1) * 0.3;
}

vec2 ripple(vec2 p, vec2 d, vec2 e, float tile, float spd, float t) {
  vec2 uv = vec2(dot(p, d), dot(p, e)) / tile - vec2(t * spd / tile, 0.0);
  vec2 g = (texture2D(uNormTex, uv).rg - 0.5) * 4.0;
  return d * g.x + e * g.y;
}
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  return length(pa - ba * h);
}
void main() {
  vec3 V = uCamPos - vPos; float dist = length(V); V /= dist;
  vec3 N = normalize(vN);

  // --- 細波紋：三層不同尺度、不同方向漂移的法線貼圖 ---
  vec2 d1 = vec2(sin(uWindAng), -cos(uWindAng)), e1 = vec2(-d1.y, d1.x);
  vec2 d2 = vec2(sin(uWindAng + 0.6), -cos(uWindAng + 0.6)), e2 = vec2(-d2.y, d2.x);
  vec2 d3 = vec2(sin(uWindAng - 0.9), -cos(uWindAng - 0.9)), e3 = vec2(-d3.y, d3.x);
  float near = 1.0 - smoothstep(30.0, 140.0, dist);
  vec2 g = ripple(vPos.xz, d1, e1, 13.0, 1.1, uTime) * 0.055
         + ripple(vPos.xz, d2, e2, 4.7, 0.7, uTime) * 0.045;
  if (near > 0.0) g += ripple(vPos.xz, d3, e3, 1.7, 0.45, uTime) * 0.035 * near;   // 最細的一層只在近處取樣
  float gs = gustF(vPos.xz);
  float rs = (0.55 + 0.45 * uChop) * mix(0.55, 1.0, 1.0 - smoothstep(200.0, 1400.0, dist)) * (0.62 + 0.6 * (gs * 0.5 + 0.5));
  if (uRain > 0.0) {
    // 雨點打在海面：細碎、快速變化的小波紋
    vec2 rp = vPos.xz * 3.2 + vec2(uTime * 7.0, -uTime * 5.0);
    g += (vec2(vn(rp), vn(rp + 31.7)) - 0.5) * 0.22 * uRain * near;
  }
  N = normalize(N + vec3(-g.x, 0.0, -g.y) * rs);

  // --- 地形深度（淺水） ---
  vec2 uv = (vPos.xz - uBox.xy) / uBox.zw;
  float th = -40.0;
  if (uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0) th = texture2D(uDepth, uv).r * 80.0 - 40.0;
  float depth = -th;

  // --- 船的陰影與船身周圍的水線泡沫 ---
  vec2 bp = vPos.xz - uBoat.xy;
  float sp = sin(uBoat.z), cp = cos(uBoat.z);
  float shadow = 0.0;
  float bd2 = dot(bp, bp);
  if (bd2 < 160.0 * 160.0) {
    vec2 sq = bp - uShadowOff;
    float sf = sq.x * sp - sq.y * cp, sr = sq.x * cp + sq.y * sp;
    float eh = (sr / (uHullC.x * 1.2)) * (sr / (uHullC.x * 1.2)) + (sf / (uHullC.y + 0.05)) * (sf / (uHullC.y + 0.05));
    shadow = smoothstep(1.25, 0.7, eh) * uHullC.z;
    float ef = (abs(sr) - uHullS.x) / (uHullS.y * 1.2); ef = ef * ef + (sf / (uHullS.z + 0.05)) * (sf / (uHullS.z + 0.05));
    shadow = max(shadow, smoothstep(1.3, 0.6, ef) * 0.8);
    float beam = min(abs(sf - uBeams.x), abs(sf - uBeams.y));
    shadow = max(shadow, step(abs(sr), uBeams.z) * smoothstep(0.16, 0.05, beam) * 0.7);
    shadow = max(shadow, smoothstep(0.9, 0.3, segDist(vPos.xz, uSailSh.xy, uSailSh.zw)) * 0.85);

  }

  // --- 光照 ---
  vec3 L = uSunDir;
  float ndv = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 R = reflect(-V, N); R.y = abs(R.y);
  vec3 refl = skyFull(R, vPos, 0.0);                                   // 倒影裡也看得到雲
  float lit = (1.0 - shadow * 0.8) * (1.0 - 0.6 * cloudShade(vPos.xz));
  // 水體：深處偏藍，浪峰受光面帶透光的藍綠（次表面散射）
  float crest = clamp(vH * 0.45 + 0.45, 0.0, 1.0);
  float thru = pow(max(dot(V, -L) * 0.5 + 0.5, 0.0), 4.0);
  float facing = max(dot(N, L), 0.0);
  vec3 water = uDeep * (0.75 + 0.35 * N.y);
  water += uSss * (crest * crest * (0.35 + 1.1 * thru) + facing * 0.12) * lit;
  float sh = 1.0 - smoothstep(0.5, 14.0, depth);
  water = mix(water, vec3(0.10, 0.50, 0.48) * (0.7 + 0.3 * lit), sh * 0.75);
  vec3 col = mix(water, refl, fres);
  col *= 1.0 - shadow * 0.12;
  // 陣風區水面較粗糙、反光較少而顯得較暗（風紋），無風區較平滑發亮
  col *= 1.0 - 0.13 * smoothstep(0.15, 0.85, gs) * (1.0 - smoothstep(300.0, 1600.0, dist)) + 0.05 * smoothstep(-0.3, -0.85, gs);
  // 太陽高光：遠處粗糙度提高，避免閃爍；近處細碎的波光
  vec3 H = normalize(L + V);
  float shin = mix(1400.0, 220.0, smoothstep(10.0, 900.0, dist));
  float spec = pow(max(dot(N, H), 0.0), shin) * shin * 0.0045 + pow(max(dot(R, L), 0.0), 80.0) * 0.14;
  col += uSunCol * min(spec * fres * 4.0, 5.0) * lit * smoothstep(0.45, 0.85, uLight);

  // --- 白沫：碎浪（雅可比）＋岸邊＋航跡＋船身 ---
  vec2 fu = vPos.xz / 9.0 + d1 * uTime * 0.05;
  float ft = texture2D(uFoamTex, fu).r * 0.6 + texture2D(uFoamTex, vPos.xz / 3.1 - d1 * uTime * 0.03).r * 0.4;
  // 船附近用「泡沫累積圖」：航跡、船身浪花、碎浪白沫會殘留、擴散再慢慢消失；遠處才用即時的碎浪判斷
  vec2 fuv = (vBase - uFoamD - uFoamC.xy + g * 6.0) / uFoamC.z + 0.5;   // 泡沫隨表層流漂移，並被細波紋輕微扭動
  float inside = smoothstep(0.5, 0.43, max(abs(fuv.x - 0.5), abs(fuv.y - 0.5)));
  float mapF = 0.0;
  if (inside > 0.0) { vec2 fm = texture2D(uFoamMap, fuv).rg; mapF = max(fm.r, fm.g) * inside; }
  float cap = smoothstep(uFoamJ + 0.03, uFoamJ - 0.09, vJac) * smoothstep(-0.1, 0.35, vH) * 0.58 * (1.0 - inside);
  float shore = smoothstep(2.6, 0.2, depth + (ft - 0.5) * 2.4 - 0.35 * sin(uTime * 1.2 + (vPos.x + vPos.z) * 0.06));
  float foamAmt = clamp(max(max(cap, shore), mapF), 0.0, 1.0);
  float foam = smoothstep(1.0 - foamAmt * 0.85, 1.12 - foamAmt * 0.85, ft) * (0.25 + 0.7 * foamAmt);
  foam *= 1.0 - smoothstep(600.0, 1600.0, dist) * 0.7;
  vec3 foamCol = vec3(0.93, 0.96, 0.98) * (0.58 + 0.42 * facing * lit) + skyCol(vec3(0.0, 1.0, 0.0)) * 0.12;
  col = mix(col, foamCol, clamp(foam, 0.0, 1.0));

  float fog = 1.0 - exp(-pow(uFogD * dist, 2.0));
  if (fog > 0.002) col = mix(col, skyCol(normalize(vec3(-V.x, 0.015, -V.z))), fog);   // 近處不必算霧色
  gl_FragColor = vec4(col, 1.0);
}`
});
const ocean = new THREE.Mesh(oceanGeometry(lowPower ? 150 : 210, lowPower ? 176 : 256), oceanMat);
ocean.frustumCulled = false; ocean.renderOrder = 2;
scene.add(ocean);

// ---------------- Foam accumulation map ----------------
// 以船為中心、256 m 見方的俯視貼圖，每幀更新一次：舊的泡沫慢慢衰減、擴散，再疊上新的航跡、船身浪花與碎浪。
// 這樣每個海面像素只要讀一次貼圖，不必每個像素都去算 19 段航跡；而且泡沫會真的「留下來」。
const FOAM_N = 512, FOAM_S = 256;
const foamOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false, generateMipmaps: false };
const foamRT = [new THREE.WebGLRenderTarget(FOAM_N, FOAM_N, foamOpts), new THREE.WebGLRenderTarget(FOAM_N, FOAM_N, foamOpts)];
let foamIdx = 0;
const foamCtr = new THREE.Vector2();
const foamUni = {
  uW: U.uW, uW2: U.uW2, uTime: U.uTime, uTrail: U.uTrail, uBoat: U.uBoat, uHullC: U.uHullC, uHullS: U.uHullS, uFloatImm: U.uFloatImm, uFoamJ: U.uFoamJ,
  uTrailBox: { value: new THREE.Vector4() },
  uDrift: { value: new THREE.Vector2() },
  uPrev: { value: null }, uFC: { value: new THREE.Vector3(0, 0, FOAM_S) }, uShift: { value: new THREE.Vector2() }, uDt: { value: 0 }, uTexel: { value: 1 / FOAM_N }
};
const foamMat = new THREE.ShaderMaterial({
  uniforms: foamUni, depthTest: false, depthWrite: false,
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
uniform sampler2D uPrev; uniform vec3 uFC; uniform vec2 uDrift; uniform vec2 uShift; uniform float uDt; uniform float uTexel; uniform float uTime;
uniform vec4 uW[6]; uniform vec4 uW2[6]; uniform vec4 uTrail[${TRAIL_N}]; uniform vec4 uBoat; uniform vec4 uHullC; uniform vec4 uHullS; uniform vec3 uFloatImm; uniform float uFoamJ; uniform vec4 uTrailBox;
varying vec2 vUv;
float hsh(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  vec2 p = uFC.xy + (vUv - 0.5) * uFC.z + uDrift;   // 貼圖存在「跟著水漂」的座標系裡
  vec2 q = vUv + uShift;
  vec2 prev = vec2(0.0);
  if (q.x > uTexel && q.y > uTexel && q.x < 1.0 - uTexel && q.y < 1.0 - uTexel) {
    // 輕微擴散：泡沫會慢慢暈開變寬
    float w = min(0.05, uDt * 1.2);
    prev = texture2D(uPrev, q).rg * (1.0 - 4.0 * w)
         + (texture2D(uPrev, q + vec2(uTexel, 0.0)).rg + texture2D(uPrev, q - vec2(uTexel, 0.0)).rg
          + texture2D(uPrev, q + vec2(0.0, uTexel)).rg + texture2D(uPrev, q - vec2(0.0, uTexel)).rg) * w;
  }
  float dith = (hsh(vUv * 517.0 + fract(uTime * 7.13)) - 0.5) / 255.0;   // 抖動，避免 8 位元精度讓衰減卡住
  // R：航跡與船身浪花，約 7 秒消散；G：碎浪白沫，約 2.5 秒消散
  float R = prev.r * exp(-uDt / 7.0) - uDt * 0.012 + dith;
  float G = prev.g * exp(-uDt / 2.5) - uDt * 0.02 + dith;

  // 碎浪：和海面頂點著色器相同的雅可比行列式判斷
  float jxx = 0.0, jzz = 0.0, jxz = 0.0, hy = 0.0;
  for (int i = 0; i < 6; i++) {
    vec4 a = uW[i]; vec4 b = uW2[i];
    float f = a.z * (dot(a.xy, p) - b.x * uTime) + b.z;
    float s = sin(f), wqs = b.y * a.z * a.w * s;
    jxx += a.x * a.x * wqs; jzz += a.y * a.y * wqs; jxz += a.x * a.y * wqs; hy += a.w * s;
  }
  float J = (1.0 - jxx) * (1.0 - jzz) - jxz * jxz;
  G = max(G, smoothstep(uFoamJ + 0.03, uFoamJ - 0.09, J) * smoothstep(-0.1, 0.35, hy) * 0.58);

  // 船身與浮木／雙船身周圍的浪花（只在船附近 14 m 內計算）
  vec2 bp = p - uBoat.xy;
  float R0 = R;
  if (dot(bp, bp) < 196.0) {
  float sp = sin(uBoat.z), cp = cos(uBoat.z);
  float f = bp.x * sp - bp.y * cp, r = bp.x * cp + bp.y * sp;
  float spd = clamp(uBoat.w / 4.0, 0.0, 1.3);
  float e = (r / uHullC.x) * (r / uHullC.x) + (f / uHullC.y) * (f / uHullC.y);
  float ring = smoothstep(0.95, 1.25, e) * smoothstep(2.2 + spd * 1.5, 1.0, e);
  float hullFoam = ring * (0.1 + 0.5 * spd) * (0.35 + 0.65 * smoothstep(-1.0, 3.5, f)) * uHullC.z;
  float e2 = (abs(r) - uHullS.x) / uHullS.y; e2 = e2 * e2 + (f / uHullS.z) * (f / uHullS.z);
  float imm = r > 0.0 ? uFloatImm.y : uFloatImm.x;
  hullFoam = max(hullFoam, smoothstep(0.9, 1.3, e2) * smoothstep(3.0, 1.0, e2) * (0.08 + 0.4 * spd) * clamp(imm, 0.0, 1.4));
  hullFoam *= mix(1.0, 0.7 + 0.8 * uFloatImm.z, smoothstep(0.0, 3.0, f));
  R = max(R, hullFoam);
  }
  // 航跡：年輕的部分依年齡展開成 V 形，較舊的部分交給累積圖自然消散
  float wake = 0.0;
  // 只有落在航跡外框內的格子才需要逐段計算
  if (p.x > uTrailBox.x && p.y > uTrailBox.y && p.x < uTrailBox.z && p.y < uTrailBox.w) {
    for (int i = 0; i < ${TRAIL_N - 1}; i++) {
      vec4 A = uTrail[i]; vec4 B = uTrail[i + 1];
      vec2 pa = p - A.xy, ba = B.xy - A.xy;
      float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
      float dd = length(pa - ba * h);
      float age = mix(A.z, B.z, h), sv = min(A.w, B.w);
      float w = 0.45 + age * 0.32;
      float decay = exp(-age * 0.22) * clamp((sv - 0.8) / 4.0, 0.0, 1.0);
      float core = smoothstep(w, w * 0.1, dd) * 0.62;
      float arm = exp(-pow((dd - w * 1.8) / (0.3 + age * 0.08), 2.0)) * 0.45;
      wake = max(wake, (core + arm) * decay);
    }
  }
  R = max(R, wake);
  gl_FragColor = vec4(clamp(R, 0.0, 1.0), clamp(G, 0.0, 1.0), 0.0, 1.0);
}`
});
const foamScene = new THREE.Scene(), foamCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const foamQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), foamMat); foamQuad.frustumCulled = false; foamScene.add(foamQuad);
for (const rt of foamRT) { renderer.setRenderTarget(rt); renderer.clear(); }
renderer.setRenderTarget(null);
U.uFoamMap.value = foamRT[0].texture;
// 表層漂流：風吹水面的漂流（約風速 3%）＋波浪的斯托克斯漂流（各成分 ω·k·a² 相加），方向朝下風
const foamDrift = new THREE.Vector2();
function surfaceDrift() {
  let stokes = 0;
  for (const w of env.waves) stokes += Math.sqrt(G * w.k) * w.k * w.a * w.a;
  const a = env.windBase * D2R, s = 0.03 * env.windSpeed + stokes;
  return { x: -Math.sin(a) * s, z: Math.cos(a) * s };
}
function updateFoamMap(dt) {
  const tx = FOAM_S / FOAM_N;
  const dv = surfaceDrift();
  foamDrift.x += dv.x * dt; foamDrift.y += dv.z * dt;
  const mx = st.x - foamDrift.x, mz = st.z - foamDrift.y;
  const cx = Math.round(mx / tx) * tx, cz = Math.round(mz / tx) * tx;   // 對齊網格，平移時不會糊掉
  foamUni.uDrift.value.copy(foamDrift);
  foamUni.uShift.value.set((cx - foamCtr.x) / FOAM_S, (cz - foamCtr.y) / FOAM_S);
  foamCtr.set(cx, cz);
  foamUni.uFC.value.set(cx, cz, FOAM_S);
  foamUni.uPrev.value = foamRT[foamIdx].texture;
  foamUni.uDt.value = dt;
  // 航跡外框（加上最寬的展開寬度），框外的格子跳過逐段計算
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9, wmax = 0;
  for (const t of trail) { if (t.spd <= 0.8 || t.age > 40) continue; x0 = Math.min(x0, t.x); z0 = Math.min(z0, t.z); x1 = Math.max(x1, t.x); z1 = Math.max(z1, t.z); wmax = Math.max(wmax, (0.45 + t.age * 0.32) * 1.8 + 0.3 + t.age * 0.16); }
  if (x1 < x0) foamUni.uTrailBox.value.set(0, 0, -1, -1);
  else foamUni.uTrailBox.value.set(x0 - wmax, z0 - wmax, x1 + wmax, z1 + wmax);
  renderer.setRenderTarget(foamRT[1 - foamIdx]); renderer.render(foamScene, foamCam); renderer.setRenderTarget(null);
  foamIdx = 1 - foamIdx;
  U.uFoamMap.value = foamRT[foamIdx].texture; U.uFoamC.value.set(cx, cz, FOAM_S); U.uFoamD.value.copy(foamDrift);
}

// ---------------- Clouds ----------------
const clouds = new THREE.Group(); scene.add(clouds);
{
  const R = rnd(77);
  for (let i = 0; i < 0; i++) {
    const m = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, opacity: 0.85 });
    const s = new THREE.Sprite(m);
    const a = R() * TAU, d = 2600 + R() * 4500;
    s.position.set(Math.cos(a) * d, 380 + R() * 520, Math.sin(a) * d);
    const sc = 900 + R() * 1300; s.scale.set(sc, sc * 0.42, 1);
    s.renderOrder = -5;
    clouds.add(s);
  }
}

// ---------------- Sun glare ----------------
// 太陽周圍的柔光：加色混合的大片光暈，被山或船擋住時會被遮住；太陽躲進雲裡時變淡
const glareTex = canvasTex(256, 256, (g, w, h) => {
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,250,235,0.32)'); gr.addColorStop(0.025, 'rgba(255,244,220,0.2)');
  gr.addColorStop(0.1, 'rgba(255,236,205,0.1)'); gr.addColorStop(0.35, 'rgba(255,228,195,0.035)'); gr.addColorStop(1, 'rgba(255,220,180,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
const glare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glareTex, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
glare.scale.set(5200, 5200, 1); glare.renderOrder = 60; scene.add(glare);
const GLARE = { calm: 0.8, moderate: 0.7, rough: 0.3, storm: 0 };
// 在 CPU 讀同一張雲貼圖：算太陽在某點上空是不是被雲擋住（和著色器裡的雲影公式相同）
function cloudShadeCPU(x, z) {
  const tex = U.uCloudTex.value; if (!tex) return 0;
  const d = tex.image.data, N = tex.image.width;
  const px = x + sunDir.x / sunDir.y * 1500, pz = z + sunDir.z / sunDir.y * 1500;
  let u = ((px / 520 + U.uCloudOff.value.x) / 8) * N - 0.5, v = ((pz / 520 + U.uCloudOff.value.y) / 8) * N - 0.5;
  const i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0;
  const at = (i, j) => d[((((j % N) + N) % N) * N + (((i % N) + N) % N)) * 4] / 255;
  const n = lerp(lerp(at(i0, j0), at(i0 + 1, j0), fu), lerp(at(i0, j0 + 1), at(i0 + 1, j0 + 1), fu), fv);
  return smooth((n - U.uCloudCov.value) / 0.16);
}
let sunCover = 0;

// ---------------- Boat model ----------------
const outriggerBoat = new THREE.Group(); outriggerBoat.rotation.order = 'YXZ'; scene.add(outriggerBoat);
let boat = outriggerBoat;
const HL = 3.6;
function halfBeam(z) { const t = Math.abs(z) / HL; return 0.5 * Math.pow(Math.max(0, 1 - Math.pow(t, 2.3)), 0.62); }
function gunY(z) { const t = z / HL; return 0.42 + 0.42 * Math.pow(t, 4); }
function keelY(z) { const t = Math.abs(z) / HL; return -0.36 * Math.pow(Math.max(0, 1 - t * t), 0.55) + 0.1 * Math.pow(t, 3); }
{
  const NS = 30, NM = 14;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= NS; i++) {
    const z = -HL + (i / NS) * HL * 2;
    const b = halfBeam(z), gy = gunY(z), ky = keelY(z);
    for (let j = 0; j <= NM; j++) {
      const ph = -Math.PI / 2 + (j / NM) * Math.PI;
      pos.push(b * Math.sin(ph), gy - (gy - ky) * Math.pow(Math.cos(ph), 0.75), z);
      uv.push(i / NS * 3, j / NM);
    }
  }
  for (let i = 0; i < NS; i++) for (let j = 0; j < NM; j++) {
    const a = i * (NM + 1) + j, b = a + NM + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const hull = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: woodTex, side: THREE.DoubleSide }));
  boat.add(hull);

  // water-mask cap: writes depth only so the sea is not drawn inside the hull
  const cpos = [], cidx = [];
  for (let i = 0; i <= NS; i++) {
    const z = -HL + (i / NS) * HL * 2, b = halfBeam(z) * 0.98, y = gunY(z) - 0.03;
    cpos.push(-b, y, z, b, y, z);
  }
  for (let i = 0; i < NS; i++) { const a = i * 2; cidx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(cpos, 3)); cg.setIndex(cidx);
  const cap = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide }));
  cap.renderOrder = 1; boat.add(cap);
}
const darkWood = new THREE.MeshLambertMaterial({ color: 0x4a3322 });
const lightWood = new THREE.MeshLambertMaterial({ color: 0x8a6a45 });
const ropeMat = new THREE.MeshLambertMaterial({ color: 0xc9b37a });
function cyl(r, len, mat, seg) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg || 8), mat); return m; }
// floor boards
for (let k = -2; k <= 2; k++) {
  const fb = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.03, 0.9), lightWood);
  fb.position.set(0, -0.1, k * 1.05); boat.add(fb);
}
// outrigger booms (akas) + floats
const FX = BOAT.floatX;
for (const z of [-1.35, 1.45]) {
  const aka = cyl(0.06, FX * 2 + 0.4, darkWood); aka.rotation.z = Math.PI / 2; aka.position.set(0, gunY(z) + 0.05, z); boat.add(aka);
  for (const sx of [-1, 1]) {
    const st = cyl(0.035, 0.52, darkWood); st.position.set(sx * FX, gunY(z) - 0.2, z); boat.add(st);
    const lash = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.02, 5, 10), ropeMat); lash.position.set(sx * 0.46, gunY(z) + 0.05, z); lash.rotation.y = Math.PI / 2; boat.add(lash);
  }
}
for (const sx of [-1, 1]) {
  const fl = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), darkWood);
  fl.scale.set(0.17, 0.15, 2.5); fl.position.set(sx * FX, 0.0, 0.05); boat.add(fl);
}
// mast
const MAST_Z = -0.7, MAST_H = 6.6;
const mast = cyl(0.075, MAST_H, darkWood, 10); mast.position.set(0, MAST_H / 2 - 0.1, MAST_Z); boat.add(mast);
// stays (rope lines)
{
  const lineMat = new THREE.LineBasicMaterial({ color: 0x8c7a55 });
  const pts = [
    [0, MAST_H - 0.2, MAST_Z, 0, gunY(-HL + 0.2) , -HL + 0.2],
    [0, MAST_H - 0.2, MAST_Z, -FX, 0.5, -1.35], [0, MAST_H - 0.2, MAST_Z, FX, 0.5, -1.35],
    [0, MAST_H - 0.2, MAST_Z, -0.45, gunY(1.8), 1.8], [0, MAST_H - 0.2, MAST_Z, 0.45, gunY(1.8), 1.8]
  ];
  const arr = []; for (const p of pts) arr.push(...p);
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  boat.add(new THREE.LineSegments(lg, lineMat));
}
// sail group (rotates with boom angle delta)
const sailGroup = new THREE.Group(); sailGroup.position.set(0, 0, MAST_Z); boat.add(sailGroup);
const BOOM_L = 3.25, BOOM_Y = 1.15;
const boom = cyl(0.05, BOOM_L, darkWood); boom.rotation.x = Math.PI / 2; boom.position.set(0, BOOM_Y, BOOM_L / 2); sailGroup.add(boom);
const TACK = new THREE.Vector3(0, BOOM_Y + 0.05, 0.08), HEAD = new THREE.Vector3(0, MAST_H - 0.25, 0.08), CLEW = new THREE.Vector3(0, BOOM_Y + 0.05, BOOM_L - 0.05);
const SN = 12, STN = 14;
const sailGeo = new THREE.BufferGeometry();
const sailBase = new Float32Array((SN + 1) * (STN + 1) * 3);
{
  const uvs = [], idx = [];
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  for (let j = 0; j <= STN; j++) for (let i = 0; i <= SN; i++) {
    const s = i / SN, t = j / STN;
    tmp.copy(TACK).lerp(CLEW, s); tmp2.copy(tmp).lerp(HEAD, t);
    const o = (j * (SN + 1) + i) * 3; sailBase[o] = tmp2.x; sailBase[o + 1] = tmp2.y; sailBase[o + 2] = tmp2.z;
    uvs.push(tmp2.z / 1.5, tmp2.y / 1.5);
  }
  for (let j = 0; j < STN; j++) for (let i = 0; i < SN; i++) {
    const a = j * (SN + 1) + i, b = a + SN + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  sailGeo.setAttribute('position', new THREE.BufferAttribute(sailBase.slice(), 3));
  sailGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  sailGeo.setIndex(idx); sailGeo.computeVertexNormals();
}
const sail = new THREE.Mesh(sailGeo, new THREE.MeshLambertMaterial({ map: sailTex, side: THREE.DoubleSide }));
sailGroup.add(sail);
// 風信帶（telltales）：帆兩面各兩條小布條。氣流順著帆面走時會平順往後飄，
// 帆收太緊（失速）下風面的會亂翻，放太鬆時上風面的會抖起來
const TT = [{ i: 3, j: 4, side: 1 }, { i: 3, j: 8, side: 1 }, { i: 3, j: 4, side: -1 }, { i: 3, j: 8, side: -1 }];
const TT_SEG = 5;
const ttPos = new Float32Array(TT.length * (TT_SEG + 1) * 2 * 3), ttCol = new Float32Array(ttPos.length);
const ttIdx = [];
TT.forEach((t, n) => {
  const base = n * (TT_SEG + 1) * 2;
  const c = t.side > 0 ? [0.1, 0.75, 0.3] : [0.9, 0.15, 0.12];
  for (let k = 0; k <= TT_SEG; k++) for (let e = 0; e < 2; e++) ttCol.set(c, (base + k * 2 + e) * 3);
  for (let k = 0; k < TT_SEG; k++) { const a = base + k * 2; ttIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
});
const ttGeo = new THREE.BufferGeometry();
ttGeo.setAttribute('position', new THREE.BufferAttribute(ttPos, 3));
ttGeo.setAttribute('color', new THREE.BufferAttribute(ttCol, 3));
ttGeo.setIndex(ttIdx);
const telltales = new THREE.Mesh(ttGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
telltales.frustumCulled = false; sailGroup.add(telltales);
const ttFlut = TT.map(() => 0);
// 帆索：從帆桁末端拉到船尾。帆被風壓在帆索上時繃直，沒吃到風時會垂下來
const SHEET_N = 12;
const sheetGeo = new THREE.BufferGeometry();
sheetGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SHEET_N + 1) * 3), 3));
const sheetLine = new THREE.Line(sheetGeo, new THREE.LineBasicMaterial({ color: 0xd8c690 }));
sheetLine.frustumCulled = false; boat.add(sheetLine);

// pennant at masthead (points where apparent wind blows)
const pennant = new THREE.Group(); pennant.position.set(0, MAST_H - 0.05, MAST_Z); boat.add(pennant);
{
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.12, 0, 0, -0.12, 0, 0, 0, 1.1], 3));
  g.computeVertexNormals();
  pennant.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xc8342c, side: THREE.DoubleSide })));
}
// steering oar
const oar = new THREE.Group(); oar.position.set(0.32, gunY(HL - 0.35) + 0.05, HL - 0.35); boat.add(oar);
{
  const shaft = cyl(0.035, 2.4, lightWood); shaft.rotation.x = 0.85; shaft.position.set(0, -0.35, 0.75); oar.add(shaft);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.55, 0.28), lightWood); blade.position.set(0, -1.1, 1.55); blade.rotation.x = 0.85; oar.add(blade);
}
// cargo: jade pieces and bundles
const jadeMat = new THREE.MeshStandardMaterial({ color: 0x2f8a5f, roughness: 0.35, metalness: 0.05, emissive: 0x0a2618 });
const sackMat = new THREE.MeshLambertMaterial({ color: 0x9b8559 });
{
  const R = rnd(3);
  for (let i = 0; i < 7; i++) {
    const j = new THREE.Mesh(new THREE.DodecahedronGeometry(0.12 + R() * 0.08, 0), jadeMat);
    j.scale.set(1.3, 0.6, 1); j.position.set((R() - 0.5) * 0.45, -0.02, 0.4 + R() * 1.0); j.rotation.set(R() * 3, R() * 3, R() * 3); boat.add(j);
  }
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), sackMat);
    s.scale.set(1, 0.7, 1.3); s.position.set((i % 2 ? 0.14 : -0.14), 0.05, -1.9 + i * 0.35); boat.add(s);
  }
}
// sailor (hidden in deck view)
const sailor = new THREE.Group(); sailor.position.set(0, 0.05, 2.75); boat.add(sailor);
{
  const skin = new THREE.MeshLambertMaterial({ color: 0x7a4f33 });
  const cloth = new THREE.MeshLambertMaterial({ color: 0x5a3f2a });
  const body = cyl(0.17, 0.62, cloth, 8); body.position.y = 0.55; sailor.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), skin); head.position.y = 1.0; sailor.add(head);
  const arm = cyl(0.05, 0.55, skin); arm.position.set(0.2, 0.66, 0.15); arm.rotation.x = -1.0; sailor.add(arm);
}

boat.traverse((o) => { if (o.isMesh && o.material.colorWrite !== false) { o.castShadow = true; o.receiveShadow = true; } });
pennant.traverse((o) => { o.castShadow = false; });

// ---------------- Foiling catamaran model ----------------
// 參考 SailGP F50 的比例：兩個細長船身、硬帆翼、L 型水翼（下風側放下、上風側收起）、T 型舵
const foilerBoat = new THREE.Group(); foilerBoat.rotation.order = 'YXZ'; foilerBoat.visible = false; scene.add(foilerBoat);
const carbon = new THREE.MeshStandardMaterial({ color: 0x1b2127, roughness: 0.45, metalness: 0.2 });
const hullPaint = new THREE.MeshStandardMaterial({ color: 0xe9eef0, roughness: 0.35, metalness: 0.05 });
const jadePaint = new THREE.MeshStandardMaterial({ color: 0x1f8a5c, roughness: 0.4, metalness: 0.1 });
const foilMat = new THREE.MeshStandardMaterial({ color: 0x2a3036, roughness: 0.3, metalness: 0.5 });
const FH = FOILER.hullX, HALF_L = 7.5;
// 船身：細長、船頭尖、船尾平，截面是上寬下窄的 U 形
function foilerHullGeo() {
  const NS = 36, NM = 16, pos = [], idx = [];
  for (let i = 0; i <= NS; i++) {
    const t = i / NS, z = -HALF_L + t * HALF_L * 2;
    const bow = Math.pow(Math.min(1, t / 0.55), 0.55), stern = 0.72 + 0.28 * Math.min(1, (1 - t) / 0.12);
    const hb = 0.42 * bow * (t > 0.88 ? stern : 1), dep = 0.62 * Math.pow(Math.min(1, t / 0.4), 0.4);
    for (let j = 0; j <= NM; j++) {
      const a = (j / NM) * TAU;
      const x = Math.sin(a) * hb, yy = Math.cos(a);
      const y = yy > 0 ? 0.55 + yy * 0.18 * bow : 0.55 + yy * dep;
      pos.push(x, y, z);
    }
  }
  for (let i = 0; i < NS; i++) for (let j = 0; j < NM; j++) {
    const a = i * (NM + 1) + j, b = a + NM + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const fHullGeo = foilerHullGeo();
for (const sx of [-1, 1]) {
  const h = new THREE.Mesh(fHullGeo, hullPaint); h.position.x = sx * FH; foilerBoat.add(h);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 9), jadePaint); stripe.position.set(sx * (FH + sx * 0.41), 0.62, 0.8); foilerBoat.add(stripe);
}
// 橫樑與中央翼座、網床
for (const z of [-2.6, 3.4]) {
  const bm = new THREE.Mesh(new THREE.BoxGeometry(FH * 2, 0.26, 0.38), carbon); bm.position.set(0, 0.95, z); foilerBoat.add(bm);
}
const podF = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 6.6), carbon); podF.position.set(0, 0.85, 0.4); foilerBoat.add(podF);
const net = new THREE.Mesh(new THREE.PlaneGeometry(FH * 2 - 0.8, 5.8), new THREE.MeshStandardMaterial({ color: 0x30383f, roughness: 0.9, transparent: true, opacity: 0.75, side: THREE.DoubleSide }));
net.rotation.x = -Math.PI / 2; net.position.set(0, 0.92, 0.4); foilerBoat.add(net);
// 船員：分在兩個船身的座艙裡
const crewMat = new THREE.MeshLambertMaterial({ color: 0x223a4f }), helmMat = new THREE.MeshLambertMaterial({ color: 0xf2b33d });
const crew = [];
for (const [x, z] of [[-FH, 1.5], [-FH, 3.2], [FH, 1.5], [FH, 3.2]]) {
  const c = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.75, 8), crewMat); body.position.y = 1.35; c.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), helmMat); head.position.y = 1.85; c.add(head);
  c.position.set(x, 0, z); foilerBoat.add(c); crew.push(c);
}
// 硬帆翼：以對稱翼型截面由下往上逐漸變窄，繞 25% 弦長處的桅桿旋轉；另有一片後緣襟翼跟著弧度彎
const wingGroup = new THREE.Group(); wingGroup.position.set(0, 1.1, -0.9); foilerBoat.add(wingGroup);
const WING_H = 22, WING_NS = 16, WING_NP = 20;
const wingBase = new Float32Array((WING_NS + 1) * WING_NP * 3);
const wingGeo = new THREE.BufferGeometry();
{
  const idx = [], uvs = [];
  for (let k = 0; k <= WING_NS; k++) {
    const h = k / WING_NS, c = lerp(4.4, 1.7, Math.pow(h, 0.9)), yy = h * WING_H;
    for (let j = 0; j < WING_NP; j++) {
      const a = j / WING_NP * TAU;
      const xc = (1 - Math.cos(a)) * 0.5;                              // 0 前緣 → 1 後緣 → 0
      const th = 0.6 * 0.13 * c * (0.2969 * Math.sqrt(xc) - 0.126 * xc - 0.3516 * xc * xc + 0.2843 * xc ** 3 - 0.1015 * xc ** 4) * 5;
      const o = (k * WING_NP + j) * 3;
      wingBase[o] = Math.sin(a) >= 0 ? th : -th; wingBase[o + 1] = yy; wingBase[o + 2] = (xc - 0.25) * c;
      uvs.push(xc, h);
    }
  }
  for (let k = 0; k < WING_NS; k++) for (let j = 0; j < WING_NP; j++) {
    const a = k * WING_NP + j, b = k * WING_NP + (j + 1) % WING_NP, c2 = a + WING_NP, d = b + WING_NP;
    idx.push(a, b, c2, b, d, c2);
  }
  wingGeo.setAttribute('position', new THREE.BufferAttribute(wingBase.slice(), 3));
  wingGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  wingGeo.setIndex(idx); wingGeo.computeVertexNormals();
}
const wingTex = canvasTex(64, 256, (g, w, h) => {
  g.fillStyle = '#eef2f3'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#1f8a5c'; g.fillRect(0, h * 0.72, w, h * 0.28);
  g.fillStyle = '#c8d0d4'; for (let i = 0; i < 8; i++) g.fillRect(0, i * h / 8, w, 2);
  g.fillStyle = '#9aa4aa'; g.fillRect(w * 0.64, 0, 2, h);
});
wingTex.wrapS = wingTex.wrapT = THREE.ClampToEdgeWrapping; wingTex.flipY = true;
const wing = new THREE.Mesh(wingGeo, new THREE.MeshStandardMaterial({ map: wingTex, roughness: 0.5, side: THREE.DoubleSide }));
wingGroup.add(wing);
// 帆翼頂端的風向帶
const fPennant = new THREE.Group(); fPennant.position.set(0, WING_H + 1.2, -0.9); foilerBoat.add(fPennant);
{
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.2, 0, 0, -0.2, 0, 0, 0, 1.8], 3));
  fPennant.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xc8342c, side: THREE.DoubleSide })));
}
// L 型水翼：垂直支柱 + 向內的水平翼；上風側那片整片收進船身上方
const boards = [];
for (const sx of [-1, 1]) {
  const g = new THREE.Group(); g.position.set(sx * FH, 0, -0.3); foilerBoat.add(g);
  const strut = new THREE.Mesh(new THREE.BoxGeometry(0.07, FOILER.foilDepth + 0.6, 0.36), foilMat); strut.position.y = -(FOILER.foilDepth + 0.6) / 2 + 0.6; g.add(strut);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(FOILER.foilOut + 0.3, 0.05, 0.42), foilMat);
  tip.position.set(-sx * (FOILER.foilOut + 0.3) / 2 + sx * 0.05, -FOILER.foilDepth, 0); g.add(tip);
  boards.push({ g, side: sx, raise: 1 });
}
// T 型舵：兩個船尾各一，下方有水平升降翼
const rudders = [];
for (const sx of [-1, 1]) {
  const g = new THREE.Group(); g.position.set(sx * FH, 0.2, HALF_L - 0.5); foilerBoat.add(g);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.4, 0.3), foilMat); blade.position.y = -1.0; g.add(blade);
  const elev = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.04, 0.3), foilMat); elev.position.y = -2.1; g.add(elev);
  rudders.push(g);
}
foilerBoat.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

function updateFoilerVisual(dt) {
  wingGroup.rotation.y = st.delta;
  fPennant.rotation.y = st.deltaFree;
  // 帆翼弧度：迎角越大、風越強，後段彎得越多（模擬雙片式翼的襟翼）
  const p = wingGeo.attributes.position.array;
  const sign = st.alpha < 0 ? -1 : 1, aa = Math.abs(st.alpha);
  const camber = sign * 0.09 * smooth((aa - 2 * D2R) / (12 * D2R));
  for (let k = 0; k <= WING_NS; k++) {
    const c = lerp(4.4, 1.7, Math.pow(k / WING_NS, 0.9));
    for (let j = 0; j < WING_NP; j++) {
      const o = (k * WING_NP + j) * 3;
      const xc = wingBase[o + 2] / c + 0.25;
      const flap = xc > 0.62 ? (xc - 0.62) / 0.38 : 0;
      p[o] = wingBase[o] + camber * c * (4 * xc * (1 - xc) * 0.35 + flap * flap * 1.3);
    }
  }
  wingGeo.attributes.position.needsUpdate = true; wingGeo.computeVertexNormals();
  for (const b of boards) {
    const target = b.side === st.board ? 1 - st.boardDown : 1;
    b.raise += (target - b.raise) * Math.min(1, dt * 3);
    b.g.position.y = b.raise * (FOILER.foilDepth + 0.3);
  }
  for (const r of rudders) r.rotation.y = st.rudder * 0.3;
}

// ---------------- Waypoint markers ----------------
let markers = [];
const buoyGeo = new THREE.CylinderGeometry(0.9, 1.2, 1.6, 12), poleGeo = new THREE.CylinderGeometry(0.08, 0.08, 7, 8);
const beamGeo = new THREE.CylinderGeometry(2.2, 2.2, 140, 16, 1, true);
function makeMarker(wp) {
  const g = new THREE.Group();
  const col = wp.finish ? 0x3fae7c : (wp.color || 0xe0463c);
  const buoy = new THREE.Mesh(buoyGeo, new THREE.MeshLambertMaterial({ color: col }));
  buoy.position.y = 0.2; buoy.castShadow = true; g.add(buoy);
  const pole = new THREE.Mesh(poleGeo, darkWood); pole.position.y = 4; g.add(pole);
  const flagG = new THREE.BufferGeometry();
  flagG.setAttribute('position', new THREE.Float32BufferAttribute([0, 7.3, 0, 0, 6.1, 0, 0, 6.7, 2.2], 3));
  const flag = new THREE.Mesh(flagG, new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide })); g.add(flag);
  const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.3, depthWrite: false, fog: false, side: THREE.DoubleSide }));
  beam.position.y = 70; beam.renderOrder = 5; g.add(beam);
  const ring = new THREE.Mesh(new THREE.RingGeometry(wp.r - 1.2, wp.r, 64), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.6; ring.renderOrder = 6; g.add(ring);
  g.position.set(wp.x, 0, wp.z);
  scene.add(g);
  return { g, buoy, flag, beam, ring, wp };
}
function buildMarkers(wps) {
  for (const mk of markers) {
    scene.remove(mk.g);
    mk.g.traverse((o) => { if (o.material && o !== mk.g) o.material.dispose(); });
    mk.ring.geometry.dispose(); mk.flag.geometry.dispose();
  }
  markers = wps.map(makeMarker);
}

// ---------------- Particles: spray ----------------
const NP = lowPower ? 360 : 700;
const pPos = new Float32Array(NP * 3), pAlpha = new Float32Array(NP), pSize = new Float32Array(NP);
const parts = [];
for (let i = 0; i < NP; i++) parts.push({ x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1 });
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('aAlpha', new THREE.BufferAttribute(pAlpha, 1));
pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1));
const pUni = { map: { value: puffTex }, uScale: { value: 400 }, uCol: { value: new THREE.Color(0.95, 0.97, 1.0) } };
const pMat = new THREE.ShaderMaterial({
  uniforms: pUni, transparent: true, depthWrite: false,
  vertexShader: `attribute float aAlpha; attribute float aSize; uniform float uScale; varying float vA;
    void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = clamp(aSize * uScale / -mv.z, 1.0, 96.0); gl_Position = projectionMatrix * mv; vA = aAlpha; }`,
  fragmentShader: `uniform sampler2D map; uniform vec3 uCol; varying float vA;
    void main(){ float a = texture2D(map, gl_PointCoord).a * vA; if (a < 0.01) discard; gl_FragColor = vec4(uCol, a); }`
});
const points = new THREE.Points(pGeo, pMat); points.frustumCulled = false; points.renderOrder = 7; scene.add(points);
let pNext = 0;
function emit(x, y, z, vx, vy, vz, life, size) {
  const p = parts[pNext]; pNext = (pNext + 1) % NP;
  p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.life = life; p.max = life; p.size = size;
}
// 航跡歷史點（船尾位置），給海面著色器畫白沫
const trail = [];
for (let i = 0; i < TRAIL_N; i++) trail.push({ x: 0, z: 0, age: 99, spd: 0 });
let trailTimer = 0;
function resetTrail() { for (const t of trail) { t.age = 99; t.spd = 0; t.x = st.x; t.z = st.z; } }

// ---------------- Wind streaks ----------------
const NW = lowPower ? 26 : 44;
const wPos = new Float32Array(NW * 6);
const streaks = [];
for (let i = 0; i < NW; i++) streaks.push({ x: (Math.random() - 0.5) * 80, y: 1 + Math.random() * 14, z: (Math.random() - 0.5) * 80, ph: Math.random() * TAU });
const wGeo = new THREE.BufferGeometry(); wGeo.setAttribute('position', new THREE.BufferAttribute(wPos, 3));
const wMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false, fog: false });
const windLines = new THREE.LineSegments(wGeo, wMat); windLines.frustumCulled = false; windLines.renderOrder = 8; scene.add(windLines);

// ---------------- Rain & lightning ----------------
const NR = lowPower ? 520 : 1200;
const rPos = new Float32Array(NR * 6), drops = [];
for (let i = 0; i < NR; i++) drops.push({ x: (Math.random() - 0.5) * 70, y: Math.random() * 32, z: (Math.random() - 0.5) * 70, v: 8 + Math.random() * 3 });
const rGeo = new THREE.BufferGeometry(); rGeo.setAttribute('position', new THREE.BufferAttribute(rPos, 3));
const rain = new THREE.LineSegments(rGeo, new THREE.LineBasicMaterial({ color: 0xc8d2dc, transparent: true, opacity: 0.32, depthWrite: false, fog: false }));
rain.frustumCulled = false; rain.renderOrder = 9; rain.visible = false; scene.add(rain);
const basePal = { zen: new THREE.Color(), hor: new THREE.Color(), hemi: 0.6 };
// 閃電：一道鋸齒狀的光，閃光照亮天空與海面，隨距離延遲傳來雷聲
const BOLT_N = 28;
const boltGeo = new THREE.BufferGeometry(); boltGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BOLT_N * 6), 3));
const bolt = new THREE.LineSegments(boltGeo, new THREE.LineBasicMaterial({ color: 0xf4f6ff, transparent: true, opacity: 1, fog: false, depthWrite: false }));
bolt.frustumCulled = false; bolt.renderOrder = 10; bolt.visible = false; scene.add(bolt);
let nextStrike = 6, strikeT = -1, flash = 0;
function strike() {
  const a = Math.random() * TAU, d = 900 + Math.random() * 2600;
  const bx = camera.position.x + Math.cos(a) * d, bz = camera.position.z + Math.sin(a) * d;
  const arr = boltGeo.attributes.position.array;
  let x = bx, y = 520 + Math.random() * 200, z = bz;
  for (let i = 0; i < BOLT_N; i++) {
    const nx = x + (Math.random() - 0.5) * 60, ny = y - (y / (BOLT_N - i)) * (0.7 + Math.random() * 0.6), nz = z + (Math.random() - 0.5) * 60;
    arr.set([x, y, z, nx, Math.max(0, ny), nz], i * 6); x = nx; y = Math.max(0, ny); z = nz;
  }
  boltGeo.attributes.position.needsUpdate = true;
  strikeT = 0;
  if (audio) setTimeout(() => thunder(d), d / 340 * 1000 * 0.35);
}
function thunder(d) {
  if (!audio) return;
  const ctx = audio.ctx, t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = audio.buf;
  const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 180 + 400 * (1 - d / 3500);
  const g = ctx.createGain(); const peak = 0.9 * (1.2 - d / 3500);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.08); g.gain.exponentialRampToValueAtTime(peak * 0.35, t + 0.8);
  g.gain.exponentialRampToValueAtTime(0.001, t + 3.2);
  src.connect(fl).connect(g).connect(ctx.destination); src.start(t); src.stop(t + 3.4);
}

// ---------------- Boat kinds ----------------
const KINDS = {
  outrigger: { name: '邊架艇', create: createBoatState, step: stepBoat, ideal: idealSheet, min: BOAT.sheetMin, max: BOAT.sheetMax,
    cam: 17, camH: 2.2, deck: [0.05, 1.7, 3.25], shadow: 9, heelWarn: 0.47, luff: 8, stall: 30,
    hullC: [0.52, 3.65, 1], hullS: [2.7, 0.2, 2.45], beams: [-1.35, 1.45, 2.8], stern: 3.3 },
  foiler: { name: '水翼雙體船', create: createFoilerState, step: stepFoiler, ideal: idealSheetFoiler, min: FOILER.sheetMin, max: FOILER.sheetMax,
    cam: 32, camH: 4.5, deck: [0, 1.9, 3.4], shadow: 17, heelWarn: 0.3, luff: 5, stall: 22,
    hullC: [0.001, 0.001, 0], hullS: [FOILER.hullX, 0.4, 7.3], beams: [-2.6, 3.4, FOILER.hullX], stern: 7 }
};
let boatKind = 'outrigger';
const K = () => KINDS[boatKind];
function setBoatKind(kind) {
  boatKind = kind;
  const k = K();
  outriggerBoat.visible = kind === 'outrigger'; foilerBoat.visible = kind === 'foiler';
  boat = kind === 'outrigger' ? outriggerBoat : foilerBoat;
  U.uHullC.value.set(k.hullC[0], k.hullC[1], k.hullC[2], 0);
  U.uHullS.value.set(k.hullS[0], k.hullS[1], k.hullS[2], 0);
  U.uBeams.value.set(k.beams[0], k.beams[1], k.beams[2]);
  const sc = sunLight.shadow.camera; sc.left = sc.bottom = -k.shadow; sc.right = sc.top = k.shadow; sc.far = kind === 'foiler' ? 160 : 120; sc.updateProjectionMatrix();
  camDist = k.cam;
  $('rideRow').hidden = kind !== 'foiler';
  $('cRide').hidden = kind !== 'foiler';
}

// ---------------- Game state ----------------
let seaKey = 'moderate';
let env = null, st = null;
let simT = 0, acc = 0;
let mode = 'title'; // title | play | paused | end | free
let elapsed = 0, timeLimit = 600, wpIndex = 0, distSailed = 0, maxSpeed = 0;
let missionKey = 'jade', mission = null, wps = [], lesson = null, lastRecord = null;
let rudCmd = 0;
const sailPath = []; let trackT = 0;   // 小地圖上的航行軌跡
let autoTrim = false, camMode = 'chase';
let sheetTarget = 30 * D2R;
let orbitYaw = 0, orbitPitch = 0, camDist = 17, lastDrag = -10, camYaw = 0;
const input = { left: false, right: false, sheetIn: false, sheetOut: false, rideUp: false, rideDown: false };

function applyPalette(key) {
  const P = PALETTES[key];
  U.uZenith.value.setRGB(...P.zen); U.uHorizon.value.setRGB(...P.hor); U.uSunCol.value.setRGB(...P.sun);
  U.uDeep.value.setRGB(...P.deep); U.uSss.value.setRGB(...P.sss); U.uFogD.value = P.fog;
  scene.fog.color.setRGB(P.hor[0] * 0.96, P.hor[1] * 0.97, P.hor[2]); scene.fog.density = P.fog;
  sunLight.intensity = P.light; hemi.intensity = 0.5 + P.light * 0.15;
  U.uLight.value = P.light; U.uCloudCov.value = P.cloud;
  U.uCirrus.value = { calm: 0.75, moderate: 0.55, rough: 0.25, storm: 0 }[key];
  U.uCirrusRot.value.set(Math.cos(42 * D2R), Math.sin(42 * D2R));
  const cg = { rough: 0.72, storm: 0.42 }[key] || 1;
  for (const c of clouds.children) { c.material.color.setScalar(cg); c.material.opacity = key === 'storm' ? 1 : 0.85; }
  U.uRain.value = P.rain || 0; rain.visible = !!P.rain;
  basePal.zen.setRGB(...P.zen); basePal.hor.setRGB(...P.hor); basePal.hemi = hemi.intensity;
  document.body.style.background = `rgb(${P.hor.map((v) => v * 255 | 0).join(',')})`;
}
function setupSea(key) {
  seaKey = key;
  const S = SEA_STATES[key];
  env = { windBase: 42, windSpeed: S.wind, hs: S.hs, gustAmp: S.gust, dirVar: S.dirVar, waves: makeWaves(S.hs, 42) };
  env.waves.forEach((w, i) => {
    U.uW.value[i].set(w.dx, w.dz, w.k, w.a);
    U.uW2.value[i].set(w.c, w.q, w.phase, w.L);
  });
  U.uChop.value = Math.min(2.6, 0.6 + S.hs * 0.8);
  U.uFoamJ.value = { calm: 0.9, moderate: 0.835, rough: 0.77, storm: 0.76 }[key];
  U.uGust.value.set(-Math.sin(42 * D2R), Math.cos(42 * D2R), S.wind * 0.9);
  applyPalette(key);
}
function resetBoat(start) {
  st = K().create();
  if (start) { st.x = start.x; st.z = start.z; st.psi = ((start.psi % 360) + 360) % 360 * D2R; }
  st.wind = windAt(env, simT);
  if (boatKind === 'foiler') { st.sheet = 60 * D2R; st.delta = -55 * D2R; }   // 水翼船起步先放開帆翼，免得強風一來就翻
  sheetTarget = st.sheet; rudCmd = 0;
  wpIndex = 0; elapsed = 0; distSailed = 0; maxSpeed = 0;
  for (const p of parts) { p.life = 0; p.y = -999; }
  resetTrail();
  sailPath.length = 0; trackT = 0;
  camYaw = -st.psi; updateMarkers();
}
setupSea('moderate');
resetBoat({ x: 0, z: 0, psi: 118 });

function updateMarkers() {
  markers.forEach((m, i) => {
    const active = i === wpIndex;
    const done = i < wpIndex;
    m.beam.visible = !done; m.ring.visible = !done;
    m.beam.material.opacity = active ? 0.42 : 0.14;
    m.ring.material.opacity = active ? 0.45 : 0.15;
    m.g.visible = true;
  });
}

// ---------------- Input ----------------
const keyMap = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'sheetIn', KeyW: 'sheetIn', ArrowDown: 'sheetOut', KeyS: 'sheetOut', KeyE: 'rideUp', KeyQ: 'rideDown' };
addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') return;
  const k = keyMap[e.code];
  if (k) { input[k] = true; e.preventDefault(); }
  if (e.code === 'KeyV' || e.code === 'KeyC') toggleCam();
  if (e.code === 'KeyT') toggleAuto();
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
});
addEventListener('keyup', (e) => { const k = keyMap[e.code]; if (k) input[k] = false; });
addEventListener('blur', () => { for (const k in input) input[k] = false; });
function holdButton(el, key) {
  const on = (e) => { e.preventDefault(); input[key] = true; el.classList.add('down'); el.setPointerCapture && el.setPointerCapture(e.pointerId); };
  const off = () => { input[key] = false; el.classList.remove('down'); };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('lostpointercapture', off);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
holdButton($('bLeft'), 'left'); holdButton($('bRight'), 'right');

const track = $('track'), knob = $('knob'), idealEl = $('ideal');
function sheetFromClientX(x) {
  const r = track.getBoundingClientRect();
  const t = clamp((x - r.left) / r.width, 0, 1);
  sheetTarget = lerp(K().min, K().max, t);
  if (autoTrim) toggleAuto(false);
}
let dragSheet = false;
track.addEventListener('pointerdown', (e) => { dragSheet = true; track.setPointerCapture(e.pointerId); sheetFromClientX(e.clientX); e.preventDefault(); });
track.addEventListener('pointermove', (e) => { if (dragSheet) sheetFromClientX(e.clientX); });
track.addEventListener('pointerup', () => { dragSheet = false; });
track.addEventListener('pointercancel', () => { dragSheet = false; });
track.addEventListener('keydown', (e) => {
  if (e.code === 'ArrowLeft') { sheetTarget = clamp(sheetTarget - 3 * D2R, K().min, K().max); e.preventDefault(); e.stopPropagation(); }
  if (e.code === 'ArrowRight') { sheetTarget = clamp(sheetTarget + 3 * D2R, K().min, K().max); e.preventDefault(); e.stopPropagation(); }
});

function toggleCam() {
  camMode = camMode === 'chase' ? 'deck' : 'chase';
  $('bCam').textContent = camMode === 'chase' ? '視角：船尾' : '視角：甲板';
  orbitYaw = 0; orbitPitch = 0;
}
function toggleAuto(force) {
  autoTrim = typeof force === 'boolean' ? force : !autoTrim;
  $('bAuto').setAttribute('aria-pressed', String(autoTrim));
}
function togglePause() {
  if (mode === 'play') { mode = 'paused'; $('pauseOv').hidden = false; $('pauseMission').textContent = mission ? mission.name : ''; }
  else if (mode === 'paused') { mode = 'play'; $('pauseOv').hidden = true; }
}
$('bCam').addEventListener('click', toggleCam);
$('bAuto').addEventListener('click', () => toggleAuto());
$('menuBtn').addEventListener('click', (e) => { e.stopPropagation(); togglePause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'play') togglePause(); });

// camera orbit (drag on canvas), zoom (wheel / pinch)
const pointers = new Map(); let pinch0 = 0, dist0 = 17;
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); dist0 = camDist; } });
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId); if (!p) return;
  if (pointers.size === 1) {
    orbitYaw -= (e.clientX - p.x) * 0.006; orbitPitch = clamp(orbitPitch + (e.clientY - p.y) * 0.004, -0.35, 0.9);
    lastDrag = performance.now() / 1000;
  } else if (pointers.size === 2) {
    p.x = e.clientX; p.y = e.clientY;
    const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch0 > 0) camDist = clamp(dist0 * pinch0 / d, 8, 60);
    return;
  }
  p.x = e.clientX; p.y = e.clientY;
});
const endPtr = (e) => { pointers.delete(e.pointerId); pinch0 = 0; };
canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
canvas.addEventListener('wheel', (e) => { camDist = clamp(camDist * (1 + Math.sign(e.deltaY) * 0.1), 8, 60); e.preventDefault(); }, { passive: false });

// ---------------- Audio (wind + water noise) ----------------
let audio = null;
function initAudio() {
  if (audio) { if (audio.ctx.state === 'suspended') audio.ctx.resume(); return; }
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    const mk = (type, f, q) => { const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = ctx.createGain(); g.gain.value = 0; src.connect(fl).connect(g).connect(ctx.destination); src.start(); return { g, fl }; };
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 200;
    const of = ctx.createBiquadFilter(); of.type = 'bandpass'; of.frequency.value = 600; of.Q.value = 6;
    const og = ctx.createGain(); og.gain.value = 0; osc.connect(of).connect(og).connect(ctx.destination); osc.start();
    audio = { ctx, buf, wind: mk('bandpass', 500, 0.6), water: mk('lowpass', 900, 0.4), rain: mk('highpass', 2500, 0.3), hum: { osc, of, og } };
  } catch (e) { audio = null; }
}

// ---------------- HUD helpers ----------------
const DIRS = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
const DIRS_EN = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function dirName(deg) { const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8; return [DIRS[i], DIRS_EN[i]]; }
function fmtTime(s) { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
const WEATHER_ICON = {
  sun: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="#ffd36b" stroke-width="2"><circle cx="12" cy="12" r="4.5" fill="#ffd36b"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
  cloud: '<svg class="ico" viewBox="0 0 24 24"><circle cx="8" cy="8" r="3.5" fill="#ffd36b"/><path d="M7 19h10a4 4 0 0 0 0-8 5 5 0 0 0-9.6 1.4A3.3 3.3 0 0 0 7 19z" fill="#e8eef3"/></svg>',
  wind: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="#e8eef3" stroke-width="2" stroke-linecap="round"><path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8"/></svg>',
  storm: '<svg class="ico" viewBox="0 0 24 24"><path d="M6 15h11a4 4 0 0 0 0-8 5 5 0 0 0-9.6 1.4A3.3 3.3 0 0 0 6 15z" fill="#aeb7c1"/><path d="M12.5 13l-3 5h3l-1.5 4 4.5-6h-3l1.5-3z" fill="#ffd36b"/><path d="M6 18l-1 2M9 18l-1 2M17 17l-1 2" stroke="#9fc4e6" stroke-width="1.6" stroke-linecap="round"/></svg>'
};
let bannerOn = false, toastTimer = 0;
function showBanner(t, sub, on) { const b = $('banner'); if (on) b.innerHTML = t + (sub ? '<small>' + sub + '</small>' : ''); b.classList.toggle('show', on); bannerOn = on; }
function toast(t, sub) { const el = $('toast'); el.innerHTML = t + (sub ? '<small>' + sub + '</small>' : ''); el.classList.add('show'); toastTimer = 2.6; }

// ---------------- Minimap ----------------
const TRACK_COLS = ['#6fa8ff', '#5fd1e0', '#6fe0a0', '#d9e36a', '#ffc24a', '#ff7a45'];   // 慢 → 快
const map = $('map'), mctx = map.getContext('2d');
const landImg = document.createElement('canvas'); landImg.width = DW; landImg.height = DH;
{
  const lc = landImg.getContext('2d'); const id = lc.createImageData(DW, DH);
  for (let i = 0; i < DW * DH; i++) {
    const h = depthData[i * 4] / 255 * 80 - 40, o = i * 4;
    if (h > 0) { id.data[o] = 214; id.data[o + 1] = 222; id.data[o + 2] = 206; id.data[o + 3] = 255; }
    else if (h > -12) { id.data[o] = 110; id.data[o + 1] = 150; id.data[o + 2] = 175; id.data[o + 3] = 150; }
  }
  lc.putImageData(id, 0, 0);
}
let mapRange = 520;
map.addEventListener('click', () => { mapRange = mapRange < 1000 ? 1500 : 520; });
function drawMap() {
  const W = map.width, C = W / 2, R = W * 0.36;
  const g = mctx; g.clearRect(0, 0, W, W);
  const psi = st.psi;
  // bezel
  g.save(); g.translate(C, C);
  g.beginPath(); g.arc(0, 0, R + 34, 0, TAU); g.fillStyle = 'rgba(214,222,230,0.92)'; g.fill();
  g.beginPath(); g.arc(0, 0, R + 6, 0, TAU); g.fillStyle = '#5f7087'; g.fill();
  g.rotate(-psi);
  g.fillStyle = '#56657a'; g.font = '700 26px "Noto Sans TC", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  ['N', 'E', 'S', 'W'].forEach((l, i) => { g.save(); g.rotate(i * Math.PI / 2); g.fillText(l, 0, -R - 20); g.restore(); });
  g.strokeStyle = '#8b99aa'; g.lineWidth = 2;
  for (let i = 0; i < 36; i++) { if (i % 9 === 0) continue; g.save(); g.rotate(i * TAU / 36); g.beginPath(); g.moveTo(0, -R - 10); g.lineTo(0, -R - (i % 3 === 0 ? 24 : 16)); g.stroke(); g.restore(); }
  g.restore();
  // map body
  g.save(); g.translate(C, C);
  g.beginPath(); g.arc(0, 0, R, 0, TAU); g.clip();
  g.fillStyle = '#3a4d6a'; g.fillRect(-R, -R, R * 2, R * 2);
  const sc = R / mapRange;
  g.rotate(-psi); g.scale(sc, sc); g.translate(-st.x, -st.z);
  g.imageSmoothingEnabled = true;
  // Taiwan coast polygon (covers land outside the raster box)
  g.fillStyle = 'rgb(214,222,206)';
  g.beginPath(); g.moveTo(-6000, -4000);
  for (let z = -4000; z <= 4000; z += 60) g.lineTo(coastX(z) + 6, z);
  g.lineTo(-6000, 4000); g.closePath(); g.fill();
  g.drawImage(landImg, BOX.x, BOX.z, BOX.w, BOX.h);
  // 航行軌跡：依當時船速分段上色（藍＝慢、黃紅＝快）
  if (sailPath.length > 1) {
    const vmax = boatKind === 'foiler' ? 18 : 4.5, lim = (mapRange * 1.6) ** 2;
    g.lineWidth = 7 / sc; g.lineCap = 'round'; g.lineJoin = 'round'; g.globalAlpha = 0.9;
    const bins = TRACK_COLS.map(() => new Path2D());
    for (let i = 1; i <= sailPath.length; i++) {
      const a = sailPath[i - 1], b = i < sailPath.length ? sailPath[i] : { x: st.x, z: st.z, v: Math.max(0, st.u) };
      const dx = b.x - st.x, dz = b.z - st.z;
      if (dx * dx + dz * dz > lim) continue;
      const k = Math.min(TRACK_COLS.length - 1, Math.floor(clamp(b.v / vmax, 0, 0.999) * TRACK_COLS.length));
      bins[k].moveTo(a.x, a.z); bins[k].lineTo(b.x, b.z);
    }
    bins.forEach((p, k) => { g.strokeStyle = TRACK_COLS[k]; g.stroke(p); });
    g.globalAlpha = 1;
  }
  // route
  const rest = wps.slice(wpIndex);
  if (rest.length) {
    g.setLineDash([22 / sc * 0.5, 16 / sc * 0.5]); g.lineWidth = 5 / sc; g.strokeStyle = '#e0463c';
    g.beginPath(); g.moveTo(st.x, st.z); for (const w of rest) g.lineTo(w.x, w.z); g.stroke(); g.setLineDash([]);
  }
  wps.forEach((w, i) => {
    g.beginPath(); g.arc(w.x, w.z, Math.max(w.r, 9 / sc), 0, TAU);
    g.fillStyle = i < wpIndex ? 'rgba(255,255,255,.25)' : (w.finish ? 'rgba(63,174,124,.85)' : (w.color ? 'rgba(242,179,61,.9)' : 'rgba(224,70,60,.85)')); g.fill();
  });
  g.restore();
  // wind arrows (flow direction, heading-up)
  const flow = (st.wind.dir + 180) * D2R - psi;
  g.save(); g.translate(C + R * 0.42, C - R * 0.42); g.rotate(flow);
  g.strokeStyle = '#4fe07a'; g.fillStyle = '#4fe07a'; g.lineWidth = 4;
  for (let k = -1; k <= 1; k++) {
    g.save(); g.translate(k * 16, Math.abs(k) * 8);
    g.beginPath(); g.moveTo(0, 24); g.lineTo(0, -18); g.stroke();
    g.beginPath(); g.moveTo(0, -28); g.lineTo(-8, -14); g.lineTo(8, -14); g.closePath(); g.fill();
    g.restore();
  }
  g.restore();
  // boat icon
  g.save(); g.translate(C, C);
  g.fillStyle = '#f3f6f8'; g.strokeStyle = '#1c2733'; g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(0, -24); g.quadraticCurveTo(12, -4, 8, 20); g.lineTo(-8, 20); g.quadraticCurveTo(-12, -4, 0, -24); g.closePath(); g.fill(); g.stroke();
  g.strokeStyle = '#e0463c'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(0, -6); g.lineTo(Math.sin(st.delta) * 22, -6 + Math.cos(st.delta) * 22); g.stroke();
  g.fillStyle = '#35b0ff'; g.fillRect(-14, 24, 28, 5);
  g.restore();
  // range label
  g.fillStyle = 'rgba(40,52,66,.8)'; g.font = '500 17px "Noto Sans TC", sans-serif'; g.textAlign = 'center';
  g.fillText('半徑 ' + (mapRange * 65 / 1000).toFixed(0) + ' km', C, C + R + 22);
}

// ---------------- Sail cloth animation ----------------
function updateSail(dt) {
  const p = sailGeo.attributes.position.array;
  const aa = Math.abs(st.alpha);
  const press = clamp(st.aws / 7, 0, 1.6);
  const luff = 1 - smooth(aa / (8 * D2R));
  const fill = smooth((aa - 2 * D2R) / (14 * D2R)) * Math.min(1, press);
  const sign = st.alpha < 0 ? -1 : 1;
  const depth = 0.12 + 0.36 * fill;
  for (let j = 0; j <= STN; j++) for (let i = 0; i <= SN; i++) {
    const s = i / SN, t = j / STN, o = (j * (SN + 1) + i) * 3;
    const cam = 4 * s * (1 - s) * Math.pow(1 - t, 0.5);
    let off = sign * depth * cam * (1 - luff * 0.7);
    off += luff * Math.sin(simT * 17 + s * 7 + t * 5) * 0.16 * s * (1 - t) * Math.min(1, st.aws / 4);
    p[o] = sailBase[o] + off;
    p[o + 1] = sailBase[o + 1]; p[o + 2] = sailBase[o + 2];
  }
  sailGeo.attributes.position.needsUpdate = true;
  sailGeo.computeVertexNormals();

  // 風信帶
  const aaD = aa * R2D, lee = sign;
  const calm = clamp(1 - st.aws / 2.5, 0, 1);
  TT.forEach((t, n) => {
    const o = (t.j * (SN + 1) + t.i) * 3;
    const bx = p[o] + t.side * 0.035, by = p[o + 1], bz = p[o + 2];
    // 這條是在上風面還是下風面？
    const leeward = t.side === lee;
    let target = 0;
    if (leeward && aaD > 27) target = clamp((aaD - 27) / 12, 0, 1);        // 失速：下風面氣流剝離
    if (!leeward && aaD < 9) target = clamp((9 - aaD) / 6, 0, 1);          // 太鬆：上風面氣流亂
    if (aaD > 60) target = 1;
    ttFlut[n] += (target - ttFlut[n]) * Math.min(1, dt * 4);
    const f = ttFlut[n];
    let x = bx, y = by, z = bz;
    const base = n * (TT_SEG + 1) * 2 * 3;
    for (let k = 0; k <= TT_SEG; k++) {
      if (k > 0) {
        const ph = simT * (14 + n * 1.7) + k * 1.3 + n * 2.1;
        // 平順：沿帆面往後；亂流：往外翻、上下捲；無風：下垂
        let vx = t.side * (0.05 + 0.8 * f * (0.6 + 0.4 * Math.sin(ph))), vy = -0.12 + f * 0.7 * Math.sin(ph * 1.3), vz = 1 - f * 0.9 * (0.5 + 0.5 * Math.cos(ph * 0.8));
        vx += Math.sin(ph * 0.5) * 0.05 * (1 - f);
        vx = lerp(vx, 0, calm); vy = lerp(vy, -1, calm); vz = lerp(vz, 0.15, calm);
        const L = 0.075 / Math.hypot(vx, vy, vz);
        x += vx * L; y += vy * L; z += vz * L;
      }
      ttPos[base + k * 6] = x; ttPos[base + k * 6 + 1] = y + 0.012; ttPos[base + k * 6 + 2] = z;
      ttPos[base + k * 6 + 3] = x; ttPos[base + k * 6 + 4] = y - 0.012; ttPos[base + k * 6 + 5] = z;
    }
  });
  ttGeo.attributes.position.needsUpdate = true;

  // 帆索鬆緊
  const cd = Math.cos(st.delta), sd = Math.sin(st.delta), bl = BOOM_L - 0.15;
  const ax = sd * bl, ay = BOOM_Y, az = MAST_Z + cd * bl;
  const bx2 = 0, by2 = gunY(2.95) + 0.03, bz2 = 2.95;
  const slack = clamp(st.sheet - Math.abs(st.delta), 0, 1);
  const sag = 0.02 + slack * 1.4;
  const sp = sheetGeo.attributes.position.array;
  for (let k = 0; k <= SHEET_N; k++) {
    const u = k / SHEET_N;
    sp[k * 3] = lerp(ax, bx2, u); sp[k * 3 + 1] = lerp(ay, by2, u) - sag * 4 * u * (1 - u); sp[k * 3 + 2] = lerp(az, bz2, u);
  }
  sheetGeo.attributes.position.needsUpdate = true;
}

// ---------------- Foiler spray ----------------
let wasCrash = 0, rideHold = 0;
function foilerSpray(dt, spd, fx, fz, rx, rz) {
  const water = waveHeight(env.waves, st.x, st.z, simT);
  // 下風側支柱切過水面的「公雞尾」水花
  if (st.depth > 0.1 && spd > 4) {
    const bx = st.x + rx * FOILER.hullX * st.board - fx * 0.3, bz = st.z + rz * FOILER.hullX * st.board - fz * 0.3;
    const wy = waveHeight(env.waves, bx, bz, simT);
    let n = Math.floor(spd * (lowPower ? 1.2 : 2) * dt * 10 + Math.random());
    while (n-- > 0) {
      const up = 1.2 + Math.random() * (1.5 + spd * 0.12), back = spd * (0.35 + Math.random() * 0.25);
      emit(bx, wy + 0.05, bz, st.vx - fx * back + rx * (Math.random() - 0.5) * 1.5, up, st.vz - fz * back + rz * (Math.random() - 0.5) * 1.5, 0.7 + Math.random() * 0.6, 0.3 + Math.random() * 0.4);
    }
    // 舵的支柱也會切出小水花
    if (Math.random() < spd * 0.08) for (const sx of [-1, 1]) {
      const ex = st.x + rx * FOILER.hullX * sx + fx * -7, ez = st.z + rz * FOILER.hullX * sx + fz * -7;
      emit(ex, waveHeight(env.waves, ex, ez, simT) + 0.05, ez, st.vx - fx * spd * 0.3, 0.8 + Math.random() * 1.5, st.vz - fz * spd * 0.3, 0.5, 0.25);
    }
  }
  // 船身在水中高速前進時的船首浪
  for (let i = 0; i < 2; i++) {
    const imm = st.imm[i];
    if (imm > 0.05 && spd > 3 && Math.random() < imm * spd * 0.15) {
      const sx = i ? 1 : -1, bx = st.x + rx * FOILER.hullX * sx + fx * 6.5, bz = st.z + rz * FOILER.hullX * sx + fz * 6.5;
      for (let k = 0; k < 3; k++) emit(bx, waveHeight(env.waves, bx, bz, simT) + 0.1, bz, st.vx * 0.5 + rx * (Math.random() - 0.5) * 3, 1 + Math.random() * 2, st.vz * 0.5 + rz * (Math.random() - 0.5) * 3, 0.8, 0.35 + Math.random() * 0.4);
    }
  }
  // 撞水瞬間的大片水花
  if (st.crash > 0.95 && wasCrash < 0.95) {
    for (let k = 0; k < (lowPower ? 90 : 180); k++) {
      const sx = Math.random() < 0.5 ? -1 : 1, bx = st.x + rx * FOILER.hullX * sx + fx * (2 + Math.random() * 5), bz = st.z + rz * FOILER.hullX * sx + fz * (2 + Math.random() * 5);
      emit(bx, water + 0.2, bz, st.vx * 0.7 + rx * sx * (1 + Math.random() * 4), 2 + Math.random() * 6, st.vz * 0.7 + rz * sx * (1 + Math.random() * 4), 1 + Math.random(), 0.5 + Math.random() * 0.8);
    }
  }
  wasCrash = st.crash;
  U.uFloatImm.value.set(clamp(st.imm[0] / 0.22, 0, 1.5), clamp(st.imm[1] / 0.22, 0, 1.5), 0);
}
function rideButton(el, dir) {
  const on = (e) => { e.preventDefault(); rideHold = dir; el.classList.add('down'); };
  const off = () => { rideHold = 0; el.classList.remove('down'); };
  el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
}
rideButton($('bRideDn'), -1); rideButton($('bRideUp'), 1);

// ---------------- Main loop ----------------
const clock = new THREE.Clock();
let hudT = 0;
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), camLook = new THREE.Vector3();
let titleSpin = 0;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 72 : 58;
  camera.updateProjectionMatrix();
  pUni.uScale.value = h * renderer.getPixelRatio() / (2 * Math.tan(camera.fov * D2R / 2));
}
addEventListener('resize', resize); resize();
let ftAcc = 0, ftN = 0, ftSkip = 60;
// 效能資訊（暫停選單可開關）：實際幀率、每幀時間、目前解析度倍率
let perfOn = false, pfAcc = 0, pfN = 0, pfT = 0;
function perfTick(raw) {
  if (!perfOn) return;
  pfAcc += raw; pfN++; pfT += raw;
  if (pfT > 0.5) {
    const ms = pfAcc / pfN * 1000;
    $('perf').innerHTML = `${(1000 / ms).toFixed(0)} fps・${ms.toFixed(1)} ms<br>×${dpr.toFixed(2)}${qualityMode === 'auto' ? ' 自動' : ''}・${renderer.domElement.width}×${renderer.domElement.height}`;
    pfAcc = 0; pfN = 0; pfT = 0;
  }
}
// 自動解析度：從 2 倍開始；每幀時間若一直貼著螢幕更新率（例如 60 Hz 的 16.7 ms），代表還有餘裕，
// 就試著往上加 0.25，直到原生解析度（iPhone 15 是 3 倍）。一旦加上去後幀時間變長，就退回並記住這個上限。
let refFrame = 1, lastUp = -1;
function setDpr(v) { dpr = v; renderer.setPixelRatio(dpr); resize(); ftSkip = 60; ftAcc = 0; ftN = 0; }
function adaptResolution(raw) {
  perfTick(raw);
  if (qualityMode !== 'auto' || document.hidden || mode === 'paused') return;
  if (ftSkip > 0) { ftSkip--; return; }                  // 剛切換時先不量
  ftAcc += raw; ftN++;
  if (ftN < 150) return;
  const avg = ftAcc / ftN; ftAcc = 0; ftN = 0;
  refFrame = Math.min(refFrame, avg);                    // 目前看過最快的平均幀時間 ≈ 螢幕更新間隔
  if (lastUp >= 0 && avg > refFrame * 1.05) {             // 剛升上去就變慢 → 退回，這一格以上不再嘗試
    dprCeil = lastUp - 0.25; lastUp = -1; setDpr(Math.max(DPR_MIN, dpr - 0.25)); return;
  }
  lastUp = -1;
  if (avg > Math.max(1 / 48, refFrame * 1.25) && dpr > DPR_MIN + 0.01) { setDpr(Math.max(DPR_MIN, dpr - 0.25)); return; }   // 場景變重（例如暴風雨）時往下降
  if (avg < refFrame * 1.06 && dpr + 0.25 <= dprCeil + 0.001) { lastUp = dpr + 0.25; setDpr(dpr + 0.25); }                // 還有餘裕就往上試
}
function applyQuality(q) {
  qualityMode = q;
  if (q === 'native') setDpr(DPR_NATIVE);
  else if (q === 'eco') setDpr(Math.min(DPR_NATIVE, 1.5));
  else if (q === 'x2') setDpr(Math.min(DPR_NATIVE, 2));
  else { dprCeil = DPR_NATIVE; refFrame = 1; lastUp = -1; setDpr(Math.min(DPR_NATIVE, 2)); }
  $('bQuality').textContent = { auto: '畫質：自動', native: '畫質：最高（原生 ' + DPR_NATIVE + '×）', x2: '畫質：固定 2×', eco: '畫質：省電（1.5×）' }[q];
}

function physics(dt) {
  // steering & sheet inputs
  // 按住越久，舵打得越多；放開後慢慢回正
  const hold = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (hold !== 0) {
    if (Math.sign(rudCmd) !== hold && rudCmd !== 0) rudCmd += hold * 3.0 * dt;
    else rudCmd += hold * 1.4 * dt;
  } else rudCmd -= clamp(rudCmd, -1.8 * dt, 1.8 * dt);
  rudCmd = clamp(rudCmd, -1, 1);
  const rud = rudCmd;
  if (input.sheetIn) { sheetTarget -= 0.8 * dt; if (autoTrim) toggleAuto(false); }
  if (input.sheetOut) { sheetTarget += 0.8 * dt; if (autoTrim) toggleAuto(false); }
  if (autoTrim) sheetTarget = K().ideal(st);
  if (mode === 'title') { sheetTarget = K().ideal(st); }
  sheetTarget = clamp(sheetTarget, K().min, K().max);
  const inp = { rudder: mode === 'title' ? Math.sin(simT * 0.1) * 0.15 : rud, sheetTarget, ride: (input.rideUp || rideHold > 0 ? 1 : 0) - (input.rideDown || rideHold < 0 ? 1 : 0) };
  const ox = st.x, oz = st.z;
  if (st.capsized) { inp.sheetTarget = K().max; inp.rudder = 0; }
  K().step(st, env, inp, simT, dt);
  if (st.capsized) { st.heelV += Math.sign(st.heel || 1) * 3.5 * dt; st.vx *= 1 - dt; st.vz *= 1 - dt; }
  else if (st.overheel > 0.8 && mode === 'play') { st.capsized = true; setTimeout(() => { if (mode === 'play') finish(false, 'capsize'); }, 1600); }
  if (mode === 'play') {
    distSailed += Math.hypot(st.x - ox, st.z - oz);
    // 小地圖軌跡：每移動約 3 m（或每 2 秒）記一個點，連同當時船速
    trackT += dt;
    const lp = sailPath[sailPath.length - 1];
    if (!lp || Math.hypot(st.x - lp.x, st.z - lp.z) > 3 || trackT > 2) {
      sailPath.push({ x: st.x, z: st.z, v: Math.max(0, st.u) }); trackT = 0;
      if (sailPath.length > 4000) sailPath.splice(0, 500);
    }
  }
}

// ---------------- Missions ----------------
const compass = (deg) => ({ x: Math.sin(deg * D2R), z: -Math.cos(deg * D2R) });
const addv = (p, deg, d) => { const u = compass(deg); return { x: p.x + u.x * d, z: p.z + u.z * d }; };
const deep = (p) => terrainHeight(p.x, p.z) < -6;
const GI = WORLD.islands[0];
const MISSIONS = {
  lesson: {
    name: '帆船教室', tag: '新手入門', en: 'Sailing school', timer: 'up',
    desc: '一步一步學會開帆船：先讓船動起來、找出最佳帆角，再練習順風、搶風和橫風回航。每一步都有提示。',
    setup: () => ({ start: { x: 300, z: -520, psi: windAt(env, simT).dir + 90 }, wps: [] }),
    win: ['結業！', 'Course complete', '你已經學會調帆、順風和搶風。接下來試試繞標賽，或挑戰臺灣玉之路。']
  },
  race: {
    name: '迎風繞標賽', tag: '計時賽', en: 'Windward race', timer: 'up',
    desc: '經典帆船賽航線：上風標設在正上風 3 百多公尺處，要靠之字形搶風繞過去，再順風衝回終點。挑戰你的最佳紀錄。',
    setup: () => {
      const S = { x: 160, z: -640 }, W = addv(S, env.windBase, 320);
      const st0 = addv(S, env.windBase + 180, 45);
      return { start: { x: st0.x, z: st0.z, psi: windAt(env, simT).dir + 65 }, wps: [
        { ...W, r: 20, name: '上風標', en: 'Windward mark', color: 0xf2b33d },
        { ...S, r: 24, name: '終點', en: 'Finish', finish: true }] };
    },
    win: ['衝線！', 'Finished', '上風段靠搶風角度，下風段靠放帆與順浪。再跑一次，看能不能刷新紀錄。']
  },
  green: {
    name: '環繞綠島', tag: '計時賽', en: 'Round Green Island', timer: 'up',
    desc: '順時針繞綠島一圈：從西北角出發，依序經過東北、東南、西南三顆浮標，再回到西北角。一圈會遇到迎風、橫風和順風。',
    setup: () => {
      const R = 85;
      return { start: { x: GI.x - 117, z: GI.z - 114, psi: Math.max(100, windAt(env, simT).dir + 70) }, wps: [
        { x: GI.x + R, z: GI.z - R, r: 30, name: '東北浮標', en: 'NE buoy' },
        { x: GI.x + R, z: GI.z + R, r: 30, name: '東南浮標', en: 'SE buoy' },
        { x: GI.x - R, z: GI.z + R, r: 30, name: '西南浮標', en: 'SW buoy' },
        { x: GI.x - R, z: GI.z - R, r: 30, name: '西北終點', en: 'NW finish', finish: true }] };
    },
    win: ['環島完成', 'Island rounded', '繞島時風從各個角度吹來，每一段都要重新調帆。']
  },
  jade: {
    name: '臺灣玉之路', tag: '限時運送', en: 'The jade route', timer: 'down',
    desc: '約三千年前，卑南文化的居民把花蓮豐田的臺灣玉渡海運往鄰近島嶼。古代的船很難逆風，航海者會等待合適的季風：趁東北季風出發，經綠島西南側，限時把玉料送到蘭嶼。',
    setup: () => ({ start: { x: 0, z: 0, psi: Math.max(118, windAt(env, simT).dir + 70) }, wps: WORLD.waypoints.map((w) => ({ ...w })) }),
    win: ['抵達蘭嶼', 'Arrived at Lanyu', '臺灣玉平安送達。蘭嶼、巴丹群島到呂宋出土的玉器，許多正是這樣一段段渡海帶過去的。']
  },
  sprint: {
    name: '橫風衝刺', tag: '極速挑戰', en: 'Reaching sprint', timer: 'up',
    desc: '一條 800 公尺的橫風直線賽道，風從側面吹來，是帆船最快的航向。從靜止起步，看你多快衝過終點。水翼船能在這裡飛起來。',
    setup: () => {
      const S = { x: 150, z: -1150 }, dir = env.windBase + 95, E = addv(S, dir, 800);
      return { start: { x: S.x, z: S.z, psi: windAt(env, simT).dir + 95 }, wps: [{ ...E, r: 28, name: '終點', en: 'Finish', finish: true }] };
    },
    win: ['衝線！', 'Finished', '橫風時視風會隨船速往前移，船越快，帆就要收得越緊。']
  },
  free: {
    name: '自由航行', tag: '不計時', en: 'Free sail', timer: 'none',
    desc: '沒有任務也沒有時間限制。從臺東岸邊出發，隨意探索綠島、蘭嶼和東部海岸。',
    setup: () => ({ start: { x: 0, z: 0, psi: 118 }, wps: [] })
  }
};

// 帆船教室的步驟：每一步有說明、完成條件，必要時會放一顆浮標
const LESSON_STEPS = [
  { title: '讓船動起來', text: '船頭已經擺在橫風方向。拖動右下角的帆索滑桿（或按 W / S），把白色圓鈕移到綠框上，帆吃到風船就會前進。',
    init: () => { toggleAuto(false); sheetTarget = K().max; },
    check: () => st.u > 1.6, prog: () => clamp(st.u / 1.6, 0, 1) },
  { title: '找出最佳帆角', text: '把帆索放鬆到帆開始抖動，再慢慢收緊到剛好不抖。帆面上紅綠兩色的風信帶都平順往後飄，就是最有效率的角度。讓「帆況」維持「帆形良好」4 秒。',
    init: (L) => { L.hold = 0; },
    tick: (L, dt) => { const aa = Math.abs(st.alpha) * R2D; if (aa >= K().luff + 1 && aa <= K().stall && st.u > 2) L.hold += dt; else L.hold = Math.max(0, L.hold - dt * 0.5); },
    check: (L) => L.hold >= 4, prog: (L) => L.hold / 4 },
  { title: '轉向下風', text: '前往紅色浮標。把船頭轉離風向時，帆索要跟著放鬆；風從船後方吹來時，帆幾乎要整個張開。',
    init: (L) => {
      const side = st.twa > 0 ? 1 : -1;
      let p = addv(st, st.wind.dir - 150 * side, 170);
      if (!deep(p)) p = addv(st, st.wind.dir + 150 * side, 170);
      L.wp = { ...p, r: 18, name: '順風浮標', en: 'Downwind buoy' };
    } },
  { title: '迎風搶風', text: '下一顆浮標在正上風，船無法直接開過去。先往一側偏離風向約 60° 前進，再把船頭轉過風、換到另一舷，走「之」字形。轉向前先保持速度，舵才轉得過去。',
    init: (L) => { L.wp = { ...addv(L.wp, env.windBase, 230), r: 20, name: '上風浮標', en: 'Upwind buoy' }; L.tacks = 0; L.side = Math.sign(st.twa); },
    tick: (L) => { const s = Math.sign(st.twa); if (Math.abs(st.twa) < 80 * D2R && s !== L.side && s !== 0) { L.tacks++; L.side = s; toast('搶風成功', '已換舷 ' + L.tacks + ' 次'); } else if (Math.abs(st.twa) >= 80 * D2R) L.side = s; },
    note: (L) => '已換舷 ' + L.tacks + ' 次' },
  { title: '橫風回航', text: '最後一段讓風從船的正側面吹來。橫風通常是最快的航向，試著把船速衝到 8 節以上，然後抵達綠色終點浮標。',
    init: (L) => {
      let p = addv(L.wp, env.windBase + 90, 210);
      if (!deep(p)) p = addv(L.wp, env.windBase - 90, 210);
      L.wp = { ...p, r: 22, name: '終點浮標', en: 'Finish buoy', finish: true };
    } }
];
function lessonEnter(i) {
  lesson.step = i;
  const S = LESSON_STEPS[i];
  if (S.init) S.init(lesson);
  wps = i >= 2 && lesson.wp ? [lesson.wp] : [];
  wpIndex = 0; buildMarkers(wps); updateMarkers();
  $('coachStep').textContent = `第 ${i + 1} / ${LESSON_STEPS.length} 步`;
  $('coachTitle').textContent = S.title;
  $('coachText').textContent = S.text;
}
function lessonTick(dt) {
  const S = LESSON_STEPS[lesson.step];
  if (S.tick) S.tick(lesson, dt);
  let done = S.check ? S.check(lesson) : false;
  if (wps.length && Math.hypot(wps[0].x - st.x, wps[0].z - st.z) < wps[0].r) done = true;
  const pr = S.prog ? clamp(S.prog(lesson), 0, 1) : null;
  $('coachBar').style.width = pr === null ? '0%' : pr * 100 + '%';
  $('coachBarWrap').hidden = pr === null;
  $('coachNote').textContent = S.note ? S.note(lesson) : '';
  if (done) {
    if (lesson.step + 1 >= LESSON_STEPS.length) { finish(true); return; }
    toast('完成：' + S.title, '下一步：' + LESSON_STEPS[lesson.step + 1].title);
    lessonEnter(lesson.step + 1);
  }
}

function bestKey() { return 'sail-best:' + missionKey + ':' + seaKey + ':' + boatKind; }
function readBest() { try { const v = localStorage.getItem(bestKey()); return v ? parseFloat(v) : null; } catch (e) { return null; } }
function writeBest(t) { try { localStorage.setItem(bestKey(), String(t)); } catch (e) { /* storage unavailable */ } }

function checkProgress(dt) {
  if (mode !== 'play') return;
  if (lesson) { lessonTick(dt); return; }
  if (!wps.length) return;
  const w = wps[wpIndex];
  if (Math.hypot(w.x - st.x, w.z - st.z) < w.r) {
    if (w.finish) { finish(true); return; }
    toast('通過' + w.name, w.en + '・下一站：' + wps[wpIndex + 1].name);
    wpIndex++; updateMarkers();
  }
  if (mission.timer === 'down' && elapsed >= timeLimit) finish(false);
}

function finish(ok, reason) {
  mode = 'end';
  const km = (distSailed * 65 / 1000).toFixed(1);
  const W = mission.win || ['完成', 'Done', ''];
  $('endTitle').textContent = ok ? W[0] : reason === 'capsize' ? '翻船了' : '時間到';
  $('endEn').textContent = ok ? W[1] : reason === 'capsize' ? 'Capsized' : 'Out of time';
  let text = W[2];
  if (reason === 'capsize') {
    text = '陣風把船壓翻了。強風時要在船身開始大幅傾斜前就放鬆帆索讓帆洩風，或把船頭稍微轉向上風減少受力。「自動調帆」也會在傾斜過大時自動放帆。';
  } else if (!ok) {
    const w = wps[wpIndex];
    text = `距離${w.name}還有約 ${(Math.hypot(w.x - st.x, w.z - st.z) * 65 / 1000).toFixed(1)} 公里。試試讓帆索貼近綠框建議角度，並避免直接頂風。`;
  }
  let rec = '';
  if (ok && mission.timer === 'up' && !lesson) {
    const best = readBest();
    if (best === null || elapsed < best) { writeBest(elapsed); rec = best === null ? '<div>紀錄<b>首次完成</b></div>' : `<div>新紀錄<b>快 ${(best - elapsed).toFixed(1)} 秒</b></div>`; }
    else rec = `<div>最佳紀錄<b>${fmtTime(best)}</b></div>`;
  }
  $('endText').textContent = text;
  $('endStats').innerHTML = `<div>用時<b>${fmtTime(elapsed)}</b></div><div>最高船速<b>${(maxSpeed * 1.944).toFixed(1)} kn</b></div>` +
    (rec || `<div>航程（實際比例）<b>${km} km</b></div>`);
  $('endOv').hidden = false;
  $('controls').classList.remove('on');
  $('coach').hidden = true;
  showBanner('', '', false);
}

function startGame() {
  const sel = document.querySelector('input[name="sea"]:checked');
  const ms = document.querySelector('input[name="mission"]:checked');
  missionKey = ms ? ms.value : 'jade';
  mission = MISSIONS[missionKey];
  const bs = document.querySelector('input[name="boat"]:checked');
  let kind = bs ? bs.value : 'outrigger';
  setBoatKind(kind);
  setupSea(sel ? sel.value : 'moderate');
  const S = mission.setup();
  wps = S.wps;
  resetBoat(S.start);
  timeLimit = mission.timer === 'down' ? SEA_STATES[seaKey].time : 0;
  lesson = missionKey === 'lesson' ? { step: 0 } : null;
  buildMarkers(wps); updateMarkers();
  mode = 'play';
  $('startOv').hidden = true; $('endOv').hidden = true; $('pauseOv').hidden = true;
  $('hud').classList.add('on'); $('controls').classList.add('on');
  $('timeLabel').innerHTML = mission.timer === 'down' ? '剩餘時間<small>Remaining time</small>' : '航行時間<small>Elapsed time</small>';
  $('coach').hidden = !lesson;
  if (lesson) lessonEnter(0);
  initAudio();
  toast('揚帆出發', wps.length ? '前往第一站：' + wps[0].name : mission.name);
}
function openMenu() {
  mode = 'title';
  $('pauseOv').hidden = true; $('endOv').hidden = true; $('startOv').hidden = false;
  $('hud').classList.remove('on'); $('controls').classList.remove('on'); $('coach').hidden = true;
  showBanner('', '', false); lastBanner = '';
  refreshMissionInfo();
}
$('bStart').addEventListener('click', startGame);
$('bAgain').addEventListener('click', startGame);
$('bRestart').addEventListener('click', startGame);
$('bMenu').addEventListener('click', openMenu);
$('bEndMenu').addEventListener('click', openMenu);
$('bResume').addEventListener('click', togglePause);
$('bQuality').addEventListener('click', () => applyQuality({ auto: 'native', native: 'x2', x2: 'eco', eco: 'auto' }[qualityMode]));
$('bPerf').addEventListener('click', () => { perfOn = !perfOn; $('perf').hidden = !perfOn; document.body.classList.toggle('perf-on', perfOn); $('bPerf').textContent = perfOn ? '隱藏效能資訊' : '顯示效能資訊'; });
$('bFree').addEventListener('click', () => {
  mode = 'play'; missionKey = 'free'; mission = MISSIONS.free; lesson = null;
  wps = []; buildMarkers(wps); elapsed = 0; timeLimit = 0;
  $('timeLabel').innerHTML = '航行時間<small>Elapsed time</small>';
  $('endOv').hidden = true; $('controls').classList.add('on');
  toast('自由航行', '不計時，盡情探索');
});

// 任務選單
{
  const box = $('missions');
  box.innerHTML = Object.entries(MISSIONS).map(([k, M]) =>
    `<label><input type="radio" name="mission" value="${k}"${k === 'lesson' ? ' checked' : ''}><b>${M.name}</b><span>${M.tag}</span></label>`).join('');
  box.addEventListener('change', refreshMissionInfo);
  $('seas').addEventListener('change', refreshMissionInfo);
  $('boats').addEventListener('change', refreshMissionInfo);
}
function refreshMissionInfo() {
  const ms = document.querySelector('input[name="mission"]:checked');
  const sea = document.querySelector('input[name="sea"]:checked');
  const M = MISSIONS[ms ? ms.value : 'lesson'];
  $('missionDesc').textContent = M.desc;
  let extra = '';
  if (M.timer === 'down') extra = '限時 ' + Math.round(SEA_STATES[sea ? sea.value : 'moderate'].time / 60) + ' 分鐘';
  else if (M.timer === 'up' && ms.value !== 'lesson') {
    const prevM = missionKey, prevS = seaKey, prevB = boatKind; missionKey = ms.value; seaKey = sea ? sea.value : 'moderate';
    const bq = document.querySelector('input[name="boat"]:checked'); boatKind = bq ? bq.value : 'outrigger';
    const b = readBest(); missionKey = prevM; seaKey = prevS; boatKind = prevB;
    extra = b ? '這個海況的最佳紀錄 ' + fmtTime(b) : '還沒有紀錄';
  }
  $('missionMeta').textContent = extra;
}
refreshMissionInfo();
if (innerWidth < innerHeight && isTouch) $('orientHint').textContent = '手機橫向握持，畫面更寬廣';

function frame() {
  requestAnimationFrame(frame);
  const rawDt = clock.getDelta();
  let dt = Math.min(rawDt, 0.1);
  const running = mode !== 'paused';
  if (running) {
    acc += dt;
    const h = 1 / 120; let n = 0;
    while (acc >= h && n < 12) { physics(h); simT += h; acc -= h; n++; }
    if (n === 12) acc = 0;
    if (mode === 'play') elapsed += Math.min(rawDt, 0.5);
    checkProgress(dt);
  } else dt = 0;
  maxSpeed = Math.max(maxSpeed, st.u);

  // boat transform
  boat.position.set(st.x, st.y + 0.02, st.z);
  boat.rotation.set(st.pitch, -st.psi, st.roll + st.heel);
  if (boatKind === 'outrigger') {
    sailGroup.rotation.y = st.delta;
    pennant.rotation.y = st.deltaFree;
    oar.rotation.y = st.rudder * 0.5;
    if (running) updateSail(dt);
  } else if (running) updateFoilerVisual(dt);

  // markers bob
  for (const m of markers) {
    const hgt = waveHeight(env.waves, m.wp.x, m.wp.z, simT);
    m.buoy.position.y = hgt + 0.2; m.flag.position.y = hgt; m.flag.rotation.y = st.wind.dir * -D2R + Math.PI;
    m.ring.position.y = Math.max(hgt, 0) + 0.6;
  }

  // spray particles + wake trail
  if (running) {
    const spd = Math.max(0, st.u);
    const fx = Math.sin(st.psi), fz = -Math.cos(st.psi), rx = Math.cos(st.psi), rz = Math.sin(st.psi);
    const hs = env.hs;
    // 船首破浪：船首插進浪裡、或高速時，濺起水花
    boat.updateMatrixWorld();
    if (boatKind === 'foiler') foilerSpray(dt, spd, fx, fz, rx, rz);
    else {
    tmpV.set(0, 0.15, -3.45); boat.localToWorld(tmpV);
    const bowWater = waveHeight(env.waves, tmpV.x, tmpV.z, simT);
    const sub = bowWater - tmpV.y;
    // 兩側浮木與船首的入水深度 → 著色器裡的水線白沫跟著變化
    for (let sIdx = 0; sIdx < 2; sIdx++) {
      tmpV2.set(sIdx ? FX : -FX, -0.05, 0.05); boat.localToWorld(tmpV2);
      const imm = clamp((waveHeight(env.waves, tmpV2.x, tmpV2.z, simT) - tmpV2.y + 0.12) / 0.28, 0, 1.5);
      if (sIdx) U.uFloatImm.value.y = imm; else U.uFloatImm.value.x = imm;
    }
    U.uFloatImm.value.z = clamp((sub + 0.3) / 0.4, 0, 1.5);
    const slam = clamp((sub + 0.25) * 2.5, 0, 2) * clamp((spd - 1.2) / 3, 0, 1.5) * (st.pitchV < 0 ? 1.6 : 0.5);
    let n = Math.floor(slam * (lowPower ? 18 : 30) * dt * 10 + Math.random());
    while (n-- > 0) {
      const side = Math.random() < 0.5 ? -1 : 1, out = 0.6 + Math.random() * 1.6;
      emit(tmpV.x + rx * side * 0.25, bowWater + 0.1, tmpV.z + rz * side * 0.25,
        st.vx * 0.55 + rx * side * out + st.wind.x * 0.08, 1.0 + Math.random() * 2.2 * (0.5 + slam * 0.5), st.vz * 0.55 + rz * side * out + st.wind.z * 0.08,
        0.7 + Math.random() * 0.7, 0.25 + Math.random() * 0.45);
    }
    // 邊架浮木激起的小水花
    if (spd > 2.5 && Math.random() < (spd - 2.5) * 0.25) {
      const side = Math.random() < 0.5 ? -1 : 1;
      tmpV2.set(side * FX, 0, -2.3); boat.localToWorld(tmpV2);
      emit(tmpV2.x, waveHeight(env.waves, tmpV2.x, tmpV2.z, simT) + 0.05, tmpV2.z, st.vx * 0.5 + rx * side, 0.6 + Math.random(), st.vz * 0.5 + rz * side, 0.6, 0.2 + Math.random() * 0.25);
    }
    }
    // 碎浪浪花：在鏡頭附近取樣，雅可比低於門檻處被風吹起浪沫
    const tries = lowPower ? 5 : 10;
    for (let k = 0; k < tries; k++) {
      const a = Math.random() * TAU, r = 6 + Math.random() * 60;
      const sx = camera.position.x + Math.cos(a) * r, sz = camera.position.z + Math.sin(a) * r;
      const J = waveJacobian(env.waves, sx, sz, simT);
      if (J < U.uFoamJ.value - 0.02 && Math.random() < 0.6) {
        const wy = waveHeight(env.waves, sx, sz, simT);
        const cnt = 2 + Math.floor(Math.random() * 3 * hs);
        for (let c = 0; c < cnt; c++) emit(sx + (Math.random() - 0.5) * 1.5, wy + 0.05, sz + (Math.random() - 0.5) * 1.5,
          st.wind.x * (0.3 + 0.03 * st.wind.spd), 0.5 + Math.random() * 1.2 * Math.min(hs, 2.5), st.wind.z * (0.3 + 0.03 * st.wind.spd), 0.8 + Math.random() * 0.8, 0.3 + Math.random() * 0.5);
      }
    }
    for (let i = 0; i < NP; i++) {
      const p = parts[i];
      if (p.life <= 0) { pPos[i * 3 + 1] = -999; pAlpha[i] = 0; continue; }
      p.life -= dt;
      p.vy -= 9.8 * dt;
      p.vx += (st.wind.x - p.vx) * 0.5 * dt; p.vz += (st.wind.z - p.vz) * 0.5 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.vy < 0 && (i & 1) === 0 && p.y < waveHeight(env.waves, p.x, p.z, simT)) p.life = 0;
      const t = clamp(p.life / p.max, 0, 1);
      pPos[i * 3] = p.x; pPos[i * 3 + 1] = p.y; pPos[i * 3 + 2] = p.z;
      pAlpha[i] = Math.min(1, t * 2.2) * 0.75;
      pSize[i] = p.size * (1.6 - t * 0.6);
    }
    pGeo.attributes.position.needsUpdate = true; pGeo.attributes.aAlpha.needsUpdate = true; pGeo.attributes.aSize.needsUpdate = true;

    // 航跡歷史點
    for (const t of trail) t.age += dt;
    let sx = st.x - fx * K().stern, sz = st.z - fz * K().stern;
    if (boatKind === 'foiler') { const ox = st.board * (FOILER.hullX - (st.foiling > 0.5 ? 0 : 0)); sx = st.x - fx * (st.foiling > 0.5 ? 0.5 : 7) + rx * ox; sz = st.z - fz * (st.foiling > 0.5 ? 0.5 : 7) + rz * ox; }
    trail[0].x = sx; trail[0].z = sz; trail[0].age = 0; trail[0].spd = spd;
    trailTimer += dt;
    if (Math.hypot(sx - trail[1].x, sz - trail[1].z) > 2.4 || trailTimer > 1.5) {
      const last = trail.pop(); last.x = sx; last.z = sz; last.age = 0; last.spd = spd;
      trail.splice(1, 0, last); trailTimer = 0;
    }
    trail.forEach((t, i) => U.uTrail.value[i].set(t.x, t.z, t.age, t.spd));
  }
  // 陰影：太陽方向投影到水面
  U.uBoat.value.set(st.x, st.z, st.psi, Math.max(0, st.u));
  const shH = boatKind === 'foiler' ? 1.0 + Math.max(0, st.ride || 0) : 0.9;
  U.uShadowOff.value.set(-sunDir.x / sunDir.y * shH, -sunDir.z / sunDir.y * shH);
  {
    if (boatKind === 'outrigger') { tmpV.set(0, BOOM_Y, BOOM_L * 0.45); sailGroup.localToWorld(tmpV); tmpV2.set(0, MAST_H * 0.72, 0.6); sailGroup.localToWorld(tmpV2); }
    else { wingGroup.updateMatrixWorld(); tmpV.set(0, 1, 0.9); wingGroup.localToWorld(tmpV); tmpV2.set(0, WING_H * 0.8, 0.4); wingGroup.localToWorld(tmpV2); }
    const k1 = tmpV.y / sunDir.y, k2 = tmpV2.y / sunDir.y;
    U.uSailSh.value.set(tmpV.x - sunDir.x * k1, tmpV.z - sunDir.z * k1, tmpV2.x - sunDir.x * k2, tmpV2.z - sunDir.z * k2);
  }
  U.uCloudOff.value.set(-U.uGust.value.x * simT * 0.016, -U.uGust.value.y * simT * 0.016);
  // 船上方有雲遮住太陽時，船上的直射光也跟著變暗（和海面雲影一致）
  sunCover += (cloudShadeCPU(st.x, st.z) - sunCover) * Math.min(1, dt * 2);
  sunLight.intensity = PALETTES[seaKey].light * (1 - 0.62 * sunCover);
  const camCover = cloudShadeCPU(camera.position.x, camera.position.z);
  glare.position.copy(camera.position).addScaledVector(sunDir, 8000);
  glare.material.opacity = (GLARE[seaKey] || 0) * (1 - 0.85 * camCover) * (1 - flash);
  sunLight.position.set(st.x + sunDir.x * 60, st.y + sunDir.y * 60, st.z + sunDir.z * 60);
  sunLight.target.position.set(st.x, st.y, st.z);

  // camera
  const now = performance.now() / 1000;
  if (mode === 'title') { titleSpin += dt * 0.06; }
  if (now - lastDrag > 2.5 && pointers.size === 0) { orbitYaw *= Math.pow(0.4, dt); orbitPitch *= Math.pow(0.4, dt); }
  if (camMode === 'chase' || mode === 'title') {
    camYaw += wrapPi(-st.psi - camYaw) * Math.min(1, dt * 1.6);
    const yaw = camYaw + orbitYaw + (mode === 'title' ? 2.4 + titleSpin : 0);
    const pitch = 0.22 + orbitPitch + (mode === 'title' ? 0.02 : 0);
    const d = mode === 'title' ? 20 : camDist;
    tmpV.set(st.x, st.y + K().camH, st.z);
    const aftX = Math.sin(yaw), aftZ = Math.cos(yaw);
    camera.position.set(tmpV.x + aftX * Math.cos(pitch) * d, tmpV.y + Math.sin(pitch) * d, tmpV.z + aftZ * Math.cos(pitch) * d);
    const wh = waveHeight(env.waves, camera.position.x, camera.position.z, simT);
    camera.position.y = Math.max(camera.position.y, wh + 1.2);
    camera.up.set(0, 1, 0);
    camera.lookAt(tmpV);
    sailor.visible = true; crew.forEach((c) => { c.visible = true; });
  } else {
    boat.updateMatrixWorld();
    const dk = K().deck, dx0 = boatKind === 'foiler' ? -st.board * (FOILER.hullX - 0.9) : dk[0];
    tmpV.set(dx0, dk[1], dk[2]); boat.localToWorld(tmpV);
    const ly = orbitYaw, lp = -orbitPitch * 0.8 - 0.04;
    tmpV2.set(dx0 - Math.sin(ly) * 20, dk[1] + Math.sin(lp) * 20, dk[2] - Math.cos(ly) * 20); boat.localToWorld(tmpV2);
    camera.position.copy(tmpV);
    // keep horizon steadier than the hull: blend the up vector
    camera.up.set(0, 1, 0).applyQuaternion(boat.quaternion).lerp(WORLD_UP, 0.7).normalize();
    camera.lookAt(tmpV2);
    sailor.visible = false; crew.forEach((c, i) => { c.visible = Math.sign(c.position.x) === st.board; });
  }
  U.uCamPos.value.copy(camera.position);
  U.uTime.value = simT;
  U.uWindAng.value = (st.wind.dir + 180) * D2R;
  ocean.position.set(camera.position.x, 0, camera.position.z);
  sky.position.copy(camera.position);
  clouds.position.set(camera.position.x * 0.9, 0, camera.position.z * 0.9);

  // wind streaks
  if (running) {
    const W = st.wind;
    const len = 0.4 + W.spd * 0.16;
    const ux = W.x / W.spd, uz = W.z / W.spd;
    for (let i = 0; i < NW; i++) {
      const s = streaks[i];
      s.x += W.x * dt * 1.3; s.z += W.z * dt * 1.3;
      let lx = s.x - camera.position.x, lz = s.z - camera.position.z;
      if (lx > 45) s.x -= 90; if (lx < -45) s.x += 90; if (lz > 45) s.z -= 90; if (lz < -45) s.z += 90;
      const y = s.y + Math.sin(simT * 0.8 + s.ph) * 0.4;
      const o = i * 6;
      wPos[o] = s.x; wPos[o + 1] = y; wPos[o + 2] = s.z;
      wPos[o + 3] = s.x + ux * len; wPos[o + 4] = y; wPos[o + 5] = s.z + uz * len;
    }
    wGeo.attributes.position.needsUpdate = true;
    wMat.opacity = clamp((W.spd - 3) / 30, 0.04, 0.16);
  }

  // rain & lightning
  if (rain.visible && running) {
    const W = st.wind, cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const dxr = W.x * 0.75, dzr = W.z * 0.75;
    for (let i = 0; i < NR; i++) {
      const d = drops[i];
      d.x += dxr * dt; d.z += dzr * dt; d.y -= d.v * dt;
      if (d.y < -2) { d.y = 30 + Math.random() * 4; d.x = (Math.random() - 0.5) * 70; d.z = (Math.random() - 0.5) * 70; }
      if (d.x > 35) d.x -= 70; if (d.x < -35) d.x += 70; if (d.z > 35) d.z -= 70; if (d.z < -35) d.z += 70;
      const o = i * 6, px = cx + d.x, py = cy - 8 + d.y, pz = cz + d.z;
      rPos[o] = px; rPos[o + 1] = py; rPos[o + 2] = pz;
      rPos[o + 3] = px - dxr * 0.06; rPos[o + 4] = py + d.v * 0.06; rPos[o + 5] = pz - dzr * 0.06;
    }
    rGeo.attributes.position.needsUpdate = true;
    nextStrike -= dt;
    if (nextStrike <= 0) { strike(); nextStrike = 7 + Math.random() * 16; }
  }
  if (strikeT >= 0) {
    strikeT += dt;
    // 典型閃電會閃兩三下
    flash = strikeT < 0.08 ? 1 : strikeT < 0.16 ? 0.25 : strikeT < 0.24 ? 0.85 : strikeT < 0.5 ? 0.85 * (1 - (strikeT - 0.24) / 0.26) : 0;
    bolt.visible = strikeT < 0.3 && flash > 0.3;
    if (strikeT > 0.6) { strikeT = -1; flash = 0; bolt.visible = false; }
  }
  if (rain.visible || flash > 0) {
    const k = 1 + flash * 2.6;
    U.uZenith.value.copy(basePal.zen).multiplyScalar(k); U.uHorizon.value.copy(basePal.hor).multiplyScalar(1 + flash * 1.6);
    hemi.intensity = basePal.hemi * (1 + flash * 2.2);
  }

  // audio
  if (audio) {
    const t = audio.ctx.currentTime;
    const on = mode === 'play' ? 1 : 0.3;
    audio.wind.g.gain.setTargetAtTime(on * clamp(st.aws / 14, 0, 1.4) * 0.18, t, 0.3);
    audio.wind.fl.frequency.setTargetAtTime(300 + st.aws * 55, t, 0.3);
    audio.water.g.gain.setTargetAtTime(on * (0.05 + clamp(st.u / 6, 0, 1) * 0.2 + env.hs * 0.03), t, 0.3);
    audio.rain.g.gain.setTargetAtTime(on * U.uRain.value * 0.5, t, 0.5);
    // 水翼高速時會發出「唱歌」般的高頻嗡嗡聲
    const hum = boatKind === 'foiler' && st.foiling > 0.5 ? clamp((st.u - 8) / 12, 0, 1) : 0;
    audio.hum.og.gain.setTargetAtTime(on * hum * 0.03, t, 0.2);
    audio.hum.osc.frequency.setTargetAtTime(120 + st.u * 14, t, 0.2); audio.hum.of.frequency.setTargetAtTime(400 + st.u * 40, t, 0.2);
  }

  if (running) updateFoamMap(dt);
  renderer.render(scene, camera);
  adaptResolution(rawDt);

  // HUD
  hudT -= dt || 0.016;
  if (toastTimer > 0) { toastTimer -= dt || 0.016; if (toastTimer <= 0) $('toast').classList.remove('show'); }
  if (hudT <= 0 && mode !== 'title') { hudT = 0.1; updateHud(); drawMap(); }
}

let lastBanner = '';
function updateHud() {
  const S = SEA_STATES[seaKey];
  $('hWeather').innerHTML = WEATHER_ICON[S.icon];
  $('hWave').textContent = S.hs.toFixed(1) + ' m';
  const W = st.wind;
  const [zh, en] = dirName(W.dir);
  $('hWindArrow').style.transform = `rotate(${(W.dir + 180) - st.psi * R2D}deg)`;
  $('hWindDir').textContent = zh + '風 ' + en;
  $('hWindSpd').innerHTML = `${W.spd.toFixed(1)} m/s<small>${(W.spd * 1.944).toFixed(1)} kn</small>`;
  $('hSpeed').innerHTML = `${(Math.max(0, st.u) * 1.944).toFixed(1)} kn<small>${Math.max(0, st.u).toFixed(1)} m/s</small>`;
  const rem = timeLimit - elapsed;
  const tm = mission ? mission.timer : 'none';
  $('hTime').textContent = tm === 'down' ? fmtTime(rem) : fmtTime(elapsed);
  $('hTimeRow').classList.toggle('low', tm === 'down' && mode === 'play' && rem < 60);

  const twa = Math.abs(st.twa * R2D);
  $('hTwa').textContent = twa.toFixed(0) + '°' + (st.twa > 0 ? ' 右舷' : ' 左舷');
  if (wps.length) {
    const w = wps[wpIndex];
    const d = Math.hypot(w.x - st.x, w.z - st.z);
    $('hNext').textContent = `下一站 ${w.name}・` + (d < 600 ? `${d.toFixed(0)} m` : `${(d * 65 / 1000).toFixed(1)} km`);
  } else $('hNext').textContent = mission && lesson ? '依照上方指示操作' : '自由航行';

  // trim status
  const aa = Math.abs(st.alpha) * R2D;
  const atMin = st.sheet <= K().min + 0.02;
  let txt, cls;
  if (twa < 36 && st.u < 2) { txt = '逆風區'; cls = 'bad'; }
  else if (boatKind === 'foiler' && (st.heelLimit || 0) > 0.8 && autoTrim) { txt = '洩力中，避免翻船'; cls = 'good'; }
  else if (aa < K().luff) { txt = '帆在抖動，收緊帆索'; cls = 'bad'; }
  else if (aa > K().stall && !atMin) { txt = '帆失速，放鬆帆索'; cls = 'bad'; }
  else if (aa > K().stall && atMin) { txt = '太靠近風向，往下風轉'; cls = 'bad'; }
  else { txt = '帆形良好'; cls = 'good'; }
  $('cTrimTxt').textContent = txt;
  $('cTrim').className = 'chip ' + cls;
  $('cTrimBar').style.width = clamp(st.cl / 1.45, 0, 1) * 100 + '%';
  $('cHeelTxt').textContent = Math.abs(st.heel * R2D).toFixed(0) + '°';
  $('cHeel').className = 'chip' + (Math.abs(st.heel) > K().heelWarn * 0.9 ? ' bad' : '');
  if (boatKind === 'foiler') {
    const fl = st.foiling > 0.5, lf = st.liftFrac || 0;
    // 起飛速度直接由升力公式反推：船重 = ½ρ·S·CL最大·v²
    const vTo = Math.sqrt(FOILER.mass * G / (0.5 * 1025 * FOILER.foilArea * 0.18 * 5.2));
    $('cRideTxt').textContent = fl ? '飛行中 ' + Math.max(0, st.ride).toFixed(1) + ' m'
      : lf > 0.25 ? '起飛中 ' + Math.round(lf * 100) + '%'
      : '船身在水中・約 ' + (vTo * 1.944).toFixed(0) + ' 節起飛';
    $('cRide').className = 'chip' + (fl ? ' good' : '');
    $('rideVal').textContent = st.rideTarget.toFixed(1) + ' m';
  }

  // no-go banner
  let bn = '';
  if (st.capsized) bn = 'capsize';
  else if (st.aground > 0) bn = 'aground';
  else if (Math.abs(st.heel) > K().heelWarn && mode === 'play') bn = 'heel';
  else if (boatKind === 'foiler' && st.crash > 0.5 && mode === 'play') bn = 'crash';
  else if (twa < 36 && Math.max(0, st.u) < 1.2 && mode === 'play') bn = 'irons';
  if (bn !== lastBanner) {
    lastBanner = bn;
    if (bn === 'capsize') showBanner('翻船了！', '船身傾斜太久，被風壓倒了', true);
    else if (bn === 'heel') showBanner('傾斜過大，快要翻船！', '立刻放鬆帆索讓帆洩風，或把船頭轉向上風一點', true);
    else if (bn === 'aground') showBanner('擱淺了！', '轉舵離開淺灘，讓風把船帶出去', true);
    else if (bn === 'crash') showBanner('落水！', '水翼破出水面失去升力，船身砸回海面。在大浪裡把飛行高度調低一點', true);
    else if (bn === 'irons') showBanner('船頭正對著風', '帆無法產生推力。用舵把船頭轉離風向約 60° 以上', true);
    else showBanner('', '', false);
  }

  // sheet slider
  const t = (sheetTarget - K().min) / (K().max - K().min);
  knob.style.left = (t * 100) + '%';
  const it = (K().ideal(st) - K().min) / (K().max - K().min);
  idealEl.style.left = (it * 100) + '%';
  $('sheetVal').textContent = (sheetTarget * R2D).toFixed(0) + '°';
  track.setAttribute('aria-valuenow', (sheetTarget * R2D).toFixed(0));
  $('rudderDial').style.left = (50 + st.rudder * 45) + '%';
  $('bLeft').classList.toggle('down', input.left); $('bRight').classList.toggle('down', input.right);
}

requestAnimationFrame(frame);
})();
