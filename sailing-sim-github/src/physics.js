// ===== 共用數學 / 海浪 / 地形 / 物理（不依賴 three.js，可在 node 測試） =====
const G = 9.81;
const TAU = Math.PI * 2;
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function wrapPi(a) { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; }
function lerp(a, b, t) { return a + (b - a) * t; }
function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

// --- value noise ---
function hash2(x, y) {
  let h = x * 374761393 + y * 668265263; h = (h ^ (h >>> 13)) * 1274126177; h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1;
}
function fbm(x, y, oct) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; }
  return s;
}
function noise1(t) { return vnoise(t, 17.3); }

// --- 世界：x 向東, z 向南（北 = -z），單位公尺，比例約 1:65 ---
const WORLD = {
  start: { x: 0, z: 0 },
  islands: [
    { name: '綠島', en: 'Green Island', x: 537, z: 154, r: 58, h: 62 },
    { name: '蘭嶼', en: 'Lanyu', x: 640, z: 1200, r: 105, h: 128 },
    { name: '', x: 700, z: 1335, r: 18, h: 14 } // 小蘭嶼附近礁岩
  ],
  waypoints: [
    { x: 440, z: 250, r: 42, name: '綠島西側', en: 'West of Green Island' },
    { x: 525, z: 305, r: 42, name: '綠島南側', en: 'South of Green Island' },
    { x: 640, z: 1062, r: 55, name: '蘭嶼', en: 'Lanyu', finish: true }
  ]
};
function coastX(z) { // 臺灣東岸海岸線 x 座標
  return -170 + 55 * Math.sin(z / 340 + 0.6) + 28 * fbm(z / 160, 3.1, 3);
}
// 脊狀多重分形：山脊尖銳、山谷圓滑，像被侵蝕過的山
function ridged(x, z, oct) {
  let s = 0, a = 0.5, f = 1, w = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    let n = 1 - Math.abs(vnoise(x * f + i * 3.7, z * f - i * 1.9));
    n *= n; n *= w; w = clamp(n * 1.8, 0, 1);
    s += n * a; norm += a; f *= 2.07; a *= 0.52;
  }
  return s / norm;
}
// 臺灣東部剖面：海岸 → 海岸山脈 → 花東縱谷 → 中央山脈
function taiwanBase(x, z) {
  const din = coastX(z) - x;
  if (din < -130) return -40;
  if (din < 0) return Math.max(-40, din / 420 * 180 + 6);
  const D1 = 330 + 80 * vnoise(z / 700, 1.7);
  const H1 = 215 + 80 * vnoise(z / 900, 5.1);
  const cliff = smooth((vnoise(z / 380, 9.3) - 0.05) * 2.2);
  const rise = smooth(din / D1);
  const valley = smooth((din - D1 - 260) / 320);
  const coastal = H1 * Math.pow(rise, 0.8) * (1 - 0.82 * valley);
  const central = 720 * smooth((din - 1000) / 1700) * (0.85 + 0.25 * vnoise(z / 1400, 2.2));
  return 6 + 9 * smooth(din / 45) + cliff * 42 * smooth(din / 26) * (1 - rise * 0.6) + coastal + central;
}
function islandBase(is, x, z) {
  const dx = x - is.x, dz = z - is.z;
  const rq = is.r * 2.85;                        // 島的最大影響半徑（2.2 × 雜訊上限 1.28），外面直接跳過
  if (dx * dx + dz * dz > rq * rq) return -40;
  const n = fbm(dx / (is.r * 0.9) + is.x, dz / (is.r * 0.9), 4);
  const d = Math.sqrt(dx * dx + dz * dz) / (is.r * (1 + 0.28 * n));
  if (d >= 2.2) return -40;
  const bump = Math.pow(Math.max(0, 1 - d * d), 1.3) * is.h * (0.75 + 0.35 * (fbm(dx / 40, dz / 40 + 9, 4) * 0.5 + 0.5));
  const shelf = (1 - smooth(d)) * 10 - 9;
  return bump + shelf;
}
// 物理、水深與小地圖用的地形（只有大形，海岸線與完整地形一致）
function terrainHeight(x, z) {
  let h = taiwanBase(x, z);
  for (const is of WORLD.islands) h = Math.max(h, islandBase(is, x, z));
  return h;
}
// 畫面用的完整地形：在大形上加侵蝕山脊、峭壁與樹冠起伏；靠近海岸線時細節淡出，海岸線不變
function terrainFull(x, z) {
  let h = -40;
  const tb = taiwanBase(x, z);
  if (tb > -40) {
    let t = tb;
    const m = clamp((tb - 8) / 50, 0, 1);
    if (m > 0) {
      const wx = x + 70 * vnoise(x / 320, z / 320 + 7), wz = z + 70 * vnoise(x / 320 + 3, z / 320);
      const r = ridged(wx / 480, wz / 480, 6);
      t += (r - 0.33) * (tb - 6) * 0.8 * m;
      t += (ridged(wx / 160, wz / 160, 4) - 0.36) * Math.min(tb - 6, 220) * 0.4 * m;  // 細密的溪谷與稜線
      t += fbm(x / 70, z / 70, 3) * 7 * m;
      t += (vnoise(x / 11, z / 11) * 0.5 + 0.5) * 3.2 * m * (1 - clamp((tb - 450) / 250, 0, 1));
    }
    h = Math.max(h, t);
  }
  for (const is of WORLD.islands) {
    const b = islandBase(is, x, z);
    if (b <= -40) continue;
    let t = b;
    const m = clamp(b / 8, 0, 1);
    if (m > 0) {
      const dx = x - is.x, dz = z - is.z;
      const r = ridged(dx / 60 + is.x * 0.01, dz / 60, 5);
      t += (r - 0.38) * b * 0.75 * m;
      const cliff = smooth((vnoise(dx / 70 + 11, dz / 70) + 0.1) * 2);
      t += cliff * 16 * smooth(b / 3) * (1 - smooth((b - 18) / 30));
      t += (vnoise(x / 9, z / 9) * 0.5 + 0.5) * 2.4 * m;
    }
    h = Math.max(h, t);
  }
  return h;
}

// --- Gerstner 海浪 ---
const SEA_STATES = {
  // 風速與浪高大致對應蒲福風級 3、4、5、7 級
  calm: { label: '晴朗', en: 'Clear', hs: 0.5, wind: 5.0, time: 1020, icon: 'sun', gust: 0.18, dirVar: 1 },
  moderate: { label: '晴時多雲', en: 'Partly cloudy', hs: 1.0, wind: 7.2, time: 780, icon: 'cloud', gust: 0.2, dirVar: 1 },
  rough: { label: '陰有陣風', en: 'Windy, overcast', hs: 1.9, wind: 10.0, time: 660, icon: 'wind', gust: 0.22, dirVar: 1.2 },
  storm: { label: '暴風雨', en: 'Storm', hs: 4.0, wind: 15.0, time: 600, icon: 'storm', gust: 0.32, dirVar: 1.8 }
};
function makeWaves(hs, windFromDeg) {
  const toward = (windFromDeg + 180) * D2R; // 浪往下風處傳遞
  const specs = [
    [72, 0, 0.32], [44, 22, 0.24], [29, -31, 0.17], [19, 48, 0.12], [13, -58, 0.08], [9, 80, 0.05]
  ];
  const waves = [];
  let chopBudget = 0.78;
  const Ls = clamp(0.8 + 0.2 * hs, 0.9, 1.6);   // 風浪越大，波長越長
  for (const [L0, off, w] of specs) {
    const L = L0 * Ls;
    const k = TAU / L;
    const a = hs * w;
    const ang = toward + off * D2R;
    // 羅盤方位 → 世界向量 (x=sin, z=-cos)
    const dx = Math.sin(ang), dz = -Math.cos(ang);
    const q = Math.min(1.2, chopBudget / (k * a * specs.length + 1e-6));
    waves.push({ L, k, a, dx, dz, c: Math.sqrt(G / k), q, phase: hash2(L | 0, 7) * TAU });
  }
  return waves;
}
function waveDisp(waves, x, z, t, out) {
  let px = 0, py = 0, pz = 0;
  for (let i = 0; i < waves.length; i++) {
    const w = waves[i];
    const f = w.k * (w.dx * x + w.dz * z - w.c * t) + w.phase;
    const cf = Math.cos(f), sf = Math.sin(f);
    const qa = w.q * w.a;
    px += w.dx * qa * cf; pz += w.dz * qa * cf; py += w.a * sf;
  }
  out.x = px; out.y = py; out.z = pz; return out;
}
const _wd = { x: 0, y: 0, z: 0 };
function waveHeight(waves, x, z, t) {
  // 反解水平位移，求 (x,z) 正上方水面高
  let sx = x, sz = z;
  for (let i = 0; i < 3; i++) { waveDisp(waves, sx, sz, t, _wd); sx = x - _wd.x; sz = z - _wd.z; }
  waveDisp(waves, sx, sz, t, _wd);
  return _wd.y;
}

// --- 帆船 ---
const BOAT = {
  mass: 950, L: 7.2, floatX: 2.7, sailArea: 15, ceHeight: 3.1,
  righting: 19000, heelI: 1800, yawI: 2600,
  sheetMin: 7 * D2R, sheetMax: 88 * D2R, rudderMax: 0.6,
  // 依文獻校正：蟹爪帆在橫風時的驅動力係數約 1.7（Marchaj 風洞試驗），失速較晚；
  // 船速約為風速的 0.4 倍（雙體航海獨木舟經驗值約 1/3），最佳速度落在真風角 90–120°
  clMax: 1.7, stallDeg: 28, cd0: 0.2, latK: 450, dragQ: 50, dragUh: 4.3, dragLin: 25
};

function createBoatState() {
  return {
    x: WORLD.start.x, z: WORLD.start.z, psi: 118 * D2R,
    vx: 0, vz: 0, r: 0,
    heel: 0, heelV: 0,
    y: 0, yV: 0, pitch: 0, pitchV: 0, roll: 0, rollV: 0,
    delta: -40 * D2R, deltaV: 0,
    sheet: 45 * D2R, rudder: 0,
    // 診斷
    u: 0, v: 0, awa: 0, aws: 0, twa: 0, alpha: 0, cl: 0, drive: 0, side: 0, deltaFree: 0,
    aground: 0, overheel: 0
  };
}

// 陣風場：一塊塊隨風飄移的強風區。海面著色器用同一個公式畫出「風紋」，
// 所以看得到深色水面的地方，船開過去真的會吃到比較強的風。
function gustField(env, x, z, t) {
  const a = env.windBase * D2R, fx = -Math.sin(a), fz = Math.cos(a), sp = env.windSpeed * 0.9;
  const px = x - fx * sp * t, pz = z - fz * sp * t;
  const g1 = Math.sin(px * 0.0131 + pz * 0.0047 + 1.3) * Math.sin(px * -0.0051 + pz * 0.0117 + 0.4);
  const g2 = Math.sin(px * 0.0213 - pz * 0.0161 + 2.1);
  return g1 * 0.7 + g2 * 0.3;
}
function windAt(env, t, x, z) {
  const dv = env.dirVar || 1, ga = env.gustAmp || 0.2;
  const dir = env.windBase + (11 * Math.sin(t / 53 + 1.3) + 7 * noise1(t / 21)) * dv; // 風來向（度）
  const gf = gustField(env, x || 0, z || 0, t);
  const gust = 1 + ga * gf + ga * 0.35 * noise1(t / 6.5 + 40) + 0.04 * Math.sin(t / 2.7);
  const spd = env.windSpeed * gust;
  const a = dir * D2R;
  return { dir, spd, gust: gf, x: -Math.sin(a) * spd, z: Math.cos(a) * spd };
}

function liftCoef(a, cmax, sd) { // a = |迎角| rad；cmax 最大升力係數；sd 失速角（度）
  const d = a * R2D;
  if (d < sd) return cmax * Math.sin(d / sd * Math.PI / 2);
  if (d < 90) return cmax * (0.82 + 0.18 * Math.exp(-(d - sd) / 4)) * Math.cos((d - sd) / (90 - sd) * Math.PI / 2);
  return 0;
}

function stepBoat(s, env, input, t, dt) {
  const B = BOAT;
  const W = windAt(env, t, s.x, s.z);
  const fx = Math.sin(s.psi), fz = -Math.cos(s.psi);   // 船首方向
  const rx = Math.cos(s.psi), rz = Math.sin(s.psi);    // 右舷方向
  const u = s.vx * fx + s.vz * fz;
  const v = s.vx * rx + s.vz * rz;
  const Vax = W.x - s.vx, Vaz = W.z - s.vz;
  const Vaf = Vax * fx + Vaz * fz, Var = Vax * rx + Vaz * rz;
  const aws = Math.hypot(Vaf, Var) + 1e-6;

  // 帆索與舵
  s.sheet = clamp(s.sheet + clamp(input.sheetTarget - s.sheet, -1.1 * dt, 1.1 * dt), B.sheetMin, B.sheetMax);
  const rTarget = clamp(input.rudder, -1, 1);
  s.rudder += clamp(rTarget - s.rudder, -2.2 * dt, 2.2 * dt);  // 舵柄轉動需要時間

  // 帆桁擺動：被風推往順風方向，受帆索限制
  const deltaFree = Math.atan2(Var, -Vaf);
  const push = 0.55 * aws * aws * Math.sin(wrapPi(deltaFree - s.delta)) * Math.cos(s.heel);
  s.deltaV += (push - 3.5 * s.deltaV) * dt;
  s.delta += s.deltaV * dt;
  if (s.delta > s.sheet) { s.delta = s.sheet; if (s.deltaV > 0) s.deltaV *= -0.15; }
  if (s.delta < -s.sheet) { s.delta = -s.sheet; if (s.deltaV < 0) s.deltaV *= -0.15; }

  const alpha = wrapPi(deltaFree - s.delta);
  const aa = Math.abs(alpha);
  const CL = liftCoef(aa, B.clMax, B.stallDeg);
  const CD = B.cd0 + CL * CL / (Math.PI * 2.4) + 1.15 * Math.sin(aa) ** 2;
  const eff = Math.cos(s.heel) ** 2;
  const q = 0.5 * 1.225 * B.sailArea * aws * aws * eff;
  const Dx = Vaf / aws, Dy = Var / aws;               // 船座標：x 前 y 右
  const Lx = alpha < 0 ? -Dy : Dy, Ly = alpha < 0 ? Dx : -Dx;
  let Fx = q * (CL * Lx + CD * Dx);
  let Fy = q * (CL * Ly + CD * Dy);
  const FySail = Fy;                                  // 帆的側向力（作用在帆的壓力中心，離水面約 3 m）

  // 船體阻力
  const uh = B.dragUh;
  const au = Math.abs(u);
  Fx -= (B.dragQ * u * au) * (1 + Math.pow(au / uh, 4)) + B.dragLin * u + 90 * Math.abs(s.r) * u;
  const FyHull = -(B.latK * Math.max(au, 0.6) * v + 520 * v * Math.abs(v)); // 船體/浮木的側向阻力（作用在水線下）
  Fy += FyHull;
  const rud0 = s.rudder * B.rudderMax;
  Fx -= 45 * u * au * rud0 * rud0;                    // 打舵的額外阻力

  // 海浪坡度（衝浪）
  const hb = waveHeight(env.waves, s.x + fx * 3.3, s.z + fz * 3.3, t);
  const hs_ = waveHeight(env.waves, s.x - fx * 3.3, s.z - fz * 3.3, t);
  const hp = waveHeight(env.waves, s.x - rx * B.floatX, s.z - rz * B.floatX, t);
  const hst = waveHeight(env.waves, s.x + rx * B.floatX, s.z + rz * B.floatX, t);
  const hc = waveHeight(env.waves, s.x, s.z, t);
  Fx += -B.mass * G * ((hb - hs_) / 6.6) * 0.22;
  // 波浪附加阻力：船在浪裡上下起伏、拍浪會多耗能量，約與浪高平方成正比，迎浪時最大
  const wtx = -Math.sin(env.windBase * D2R), wtz = Math.cos(env.windBase * D2R);  // 浪前進方向
  const headSea = Math.max(0, -(fx * wtx + fz * wtz));
  Fx -= 32 * env.hs * env.hs * (0.3 + 0.7 * headSea) * clamp(u / 4, -0.5, 1.5);

  const m = B.mass;
  const du = Fx / (m * 1.08), dv = Fy / (m * 1.7);
  s.vx += (du * fx + dv * rx) * dt;
  s.vz += (du * fz + dv * rz) * dt;

  // 轉向：舵效隨船速；另有少量划槳/壓舵讓靜止時仍可轉動
  const rud = s.rudder * B.rudderMax;
  let N = 300 * u * au * rud + 900 * rud * (1 - clamp(au / 2, 0, 1));
  N += -FySail * 0.22;                                // 迎風舵：只來自帆的側向力
  N += (hst - hp) * 90 * env.hs * Math.sin(t * 0.7);  // 浪致偏擺
  N -= 3800 * s.r + 2600 * s.r * Math.abs(s.r);
  s.r += N / B.yawI * dt;
  s.psi = (s.psi + s.r * dt) % TAU; if (s.psi < 0) s.psi += TAU;

  // 橫傾
  // 橫傾力矩：帆的側向力在高處往下風推，船體側向阻力在水線下反向拉，形成力偶。
  // 轉彎時船體側向力朝向彎內，作用點在重心下方 → 船身略往彎外傾，而不是像飛機一樣往內壓。
  const M = -FySail * B.ceHeight + FyHull * 0.18 - B.righting * Math.sin(s.heel) - 2600 * s.heelV;
  s.heelV += M / B.heelI * dt;
  s.heel = clamp(s.heel + s.heelV * dt, -1.2, 1.2);
  // 過度傾斜：超過約 36° 並持續，就會翻船
  if (Math.abs(s.heel) > 0.63) s.overheel += dt; else s.overheel = Math.max(0, s.overheel - dt * 2);

  // 浮力：起伏 / 縱搖 / 橫搖
  const hAvg = hc * 0.4 + (hb + hs_ + hp + hst) * 0.15;
  s.yV += ((hAvg - 0.05 - s.y) * 22 - 6.5 * s.yV) * dt; s.y += s.yV * dt;
  const pT = Math.atan2(hb - hs_, 6.6);
  s.pitchV += ((pT - s.pitch) * 26 - 7 * s.pitchV) * dt; s.pitch += s.pitchV * dt;
  const rT = Math.atan2(hst - hp, B.floatX * 2);
  s.rollV += ((rT - s.roll) * 24 - 7 * s.rollV) * dt; s.roll += s.rollV * dt;

  // 位置 + 擱淺
  const bx = s.x + fx * 3 + s.vx * dt, bz = s.z + fz * 3 + s.vz * dt;
  const th = terrainHeight(bx, bz);
  if (th > -0.6) {
    // 擱淺：沿地形坡度把船推回深水，並去掉朝岸的速度
    const e = 2;
    const gx = terrainHeight(bx + e, bz) - terrainHeight(bx - e, bz);
    const gz = terrainHeight(bx, bz + e) - terrainHeight(bx, bz - e);
    const gl = Math.hypot(gx, gz) || 1, ux = gx / gl, uz = gz / gl;
    const vin = s.vx * ux + s.vz * uz;
    if (vin > 0) { s.vx -= ux * vin * 1.4; s.vz -= uz * vin * 1.4; }
    s.vx *= 0.97; s.vz *= 0.97;
    s.x += s.vx * dt - ux * 0.8 * dt; s.z += s.vz * dt - uz * 0.8 * dt;
    s.aground = 1.5;
  } else { s.x += s.vx * dt; s.z += s.vz * dt; }
  s.aground = Math.max(0, s.aground - dt);

  // 診斷
  s.u = u; s.v = v; s.aws = aws; s.alpha = alpha; s.cl = CL; s.drive = Fx; s.side = Fy; s.deltaFree = deltaFree;
  s.awa = Math.atan2(-Var, -Vaf); // 風從哪舷來：+ 右舷
  const twx = -W.x, twz = -W.z;   // 真風來向向量
  s.twa = Math.atan2(twx * rx + twz * rz, twx * fx + twz * fz);
  s.wind = W;
  s.leeway = Math.atan2(v, Math.max(0.3, Math.abs(u)));
  return s;
}

// 最佳帆索（供提示）：讓迎角約 20°
function idealSheet(s) {
  // 傾斜太大時建議放帆洩風（depower），寧可慢一點也不要翻船
  const depower = clamp((Math.abs(s.heel) - 0.33) * 2.4, 0, 0.8);
  return clamp(Math.abs(s.deltaFree) - 20 * D2R + depower, BOAT.sheetMin, BOAT.sheetMax);
}
if (typeof module !== 'undefined') module.exports = { terrainFull, gustField, WORLD, SEA_STATES, makeWaves, waveHeight, waveDisp, terrainHeight, createBoatState, stepBoat, idealSheet, windAt, D2R, R2D, BOAT };
// 海面雅可比行列式：<1 表示水面被擠壓（浪峰），越小越容易碎浪起白沫
function waveJacobian(waves, x, z, t) {
  let jxx = 0, jzz = 0, jxz = 0;
  for (let i = 0; i < waves.length; i++) {
    const w = waves[i];
    const f = w.k * (w.dx * x + w.dz * z - w.c * t) + w.phase;
    const s = w.q * w.a * w.k * Math.sin(f);
    jxx += w.dx * w.dx * s; jzz += w.dz * w.dz * s; jxz += w.dx * w.dz * s;
  }
  return (1 - jxx) * (1 - jzz) - jxz * jxz;
}
if (typeof module !== 'undefined') module.exports.waveJacobian = waveJacobian;

// ============================================================
// 水翼雙體船（參考 SailGP F50 的量級：15 m、約 2.4 t、船速約 15 節起飛、最高約風速 3 倍）
// 與邊架艇不同：船身靠水翼升力離開水面，飛行高度由自動飛控調整水翼迎角；
// 速度上限主要來自「扶正力矩」——帆的力量太大船就會翻，所以要一直放帆洩力。
// ============================================================
const FOILER = {
  mass: 2400, hullX: 4.4, foilDepth: 2.3, foilOut: 1.4, foilArea: 1.5, sailArea: 85, ce: 8.2,
  clMax: 1.8, stallDeg: 17, cd0: 0.04, ar: 4.5,
  sheetMin: 3 * D2R, sheetMax: 80 * D2R, rMin: 30, heelI: 90000, yawI: 60000,
  rideDefault: 1.3
};
function createFoilerState() {
  const s = createBoatState();
  Object.assign(s, { kind: 'foiler', y: -0.2, yV: 0, rake: 0.1, rideTarget: FOILER.rideDefault, board: -1, boardDown: 1,
    vent: 0, foiling: 0, crash: 0, depth: 2, imm: [0.2, 0.2], liftFrac: 0, sheet: 20 * D2R, delta: -15 * D2R });
  return s;
}
function stepFoiler(s, env, input, t, dt) {
  const B = FOILER, m = B.mass;
  const W = windAt(env, t, s.x, s.z);
  const fx = Math.sin(s.psi), fz = -Math.cos(s.psi), rx = Math.cos(s.psi), rz = Math.sin(s.psi);
  const u = s.vx * fx + s.vz * fz, v = s.vx * rx + s.vz * rz, au = Math.abs(u);
  const Vax = W.x - s.vx, Vaz = W.z - s.vz;
  const Vaf = Vax * fx + Vaz * fz, Var = Vax * rx + Vaz * rz;
  const aws = Math.hypot(Vaf, Var) + 1e-6;

  s.sheet = clamp(s.sheet + clamp(input.sheetTarget - s.sheet, -1.4 * dt, 1.4 * dt), B.sheetMin, B.sheetMax);
  s.rudder += clamp(clamp(input.rudder, -1, 1) - s.rudder, -2.5 * dt, 2.5 * dt);
  if (input.ride) s.rideTarget = clamp(s.rideTarget + input.ride * 0.8 * dt, 0.6, 2.0);

  // 硬帆翼：與軟帆相同的視風與迎角計算，但升阻比高得多
  const deltaFree = Math.atan2(Var, -Vaf);
  s.deltaV += (0.9 * aws * aws * Math.sin(wrapPi(deltaFree - s.delta)) - 5 * s.deltaV) * dt;
  s.delta += s.deltaV * dt;
  if (s.delta > s.sheet) { s.delta = s.sheet; if (s.deltaV > 0) s.deltaV *= -0.1; }
  if (s.delta < -s.sheet) { s.delta = -s.sheet; if (s.deltaV < 0) s.deltaV *= -0.1; }
  const alpha = wrapPi(deltaFree - s.delta), aa = Math.abs(alpha);
  const CL = liftCoef(aa, B.clMax, B.stallDeg);
  const CD = B.cd0 + CL * CL / (Math.PI * B.ar * 0.9) + 1.2 * Math.sin(aa) ** 2;
  const q = 0.5 * 1.225 * B.sailArea * aws * aws * Math.cos(s.heel) ** 2;
  const Dx = Vaf / aws, Dy = Var / aws;
  const Lx = alpha < 0 ? -Dy : Dy, Ly = alpha < 0 ? Dx : -Dx;
  let Fx = q * (CL * Lx + CD * Dx), Fy = q * (CL * Ly + CD * Dy);
  const FySail = Fy;
  Fx -= 0.5 * 1.225 * 2.0 * u * au;                          // 船體與人員的空氣阻力

  // 哪一邊的水翼放下：永遠用下風側那片（搶風或順風換舷後要重新放板）
  const windSide = Math.sign(Var) || 1;                     // 視風吹向右舷 → 右舷是下風
  if (windSide !== s.board && aws > 2) { s.boardSwitch = (s.boardSwitch || 0) + dt; if (s.boardSwitch > 0.6) { s.board = windSide; s.boardDown = 0; s.boardSwitch = 0; } }
  else s.boardSwitch = 0;
  s.boardDown = Math.min(1, s.boardDown + dt / 2.2);

  // 水面高度：兩個船身、下風水翼
  const hxL = s.x + rx * B.hullX * -1, hzL = s.z + rz * B.hullX * -1, hxR = s.x + rx * B.hullX, hzR = s.z + rz * B.hullX;
  const wL = waveHeight(env.waves, hxL, hzL, t), wR = waveHeight(env.waves, hxR, hzR, t);
  const fxw = s.x + rx * (B.hullX - B.foilOut * 0.5) * s.board, fzw = s.z + rz * (B.hullX - B.foilOut * 0.5) * s.board;
  const wF = waveHeight(env.waves, fxw, fzw, t);
  const bowW = waveHeight(env.waves, s.x + fx * 6.5, s.z + fz * 6.5, t);
  // 橫傾：heel > 0 = 右舷抬高
  const yL = s.y - B.hullX * Math.sin(s.heel), yR = s.y + B.hullX * Math.sin(s.heel);
  const immL = clamp(wL - yL, 0, 1.0), immR = clamp(wR - yR, 0, 1.0);
  s.imm = [immL, immR];
  const hullY = s.board > 0 ? yR : yL;
  const foilY = hullY - B.foilDepth * s.boardDown;
  const depth = wF - foilY;                                 // 水翼在水面下多深
  s.depth = depth;
  const water = (wL + wR) * 0.5;
  const ride = s.y - water;                                 // 船底離水面多高

  // 飛控：依速度算出需要的升力係數當作前饋，再用高度誤差修正；翼面轉動有速率限制
  const vf = Math.max(au, 1.5);
  const qw = 0.5 * 1025 * B.foilArea * vf * vf;
  const clReq = m * G / qw;
  s.rideI = clamp((s.rideI || 0) + (s.rideTarget - ride) * dt * 0.05, -0.05, 0.05);
  const rakeCmd = clamp(clReq / 5.2 - s.pitch * 0.8 + 0.08 * (s.rideTarget - ride) + s.rideI - 0.06 * s.yV, -0.08, 0.18);
  s.rake += clamp(rakeCmd - s.rake, -0.5 * dt, 0.5 * dt);
  // 水翼接近水面會失去升力；一旦破水吸入空氣（通氣）升力幾乎歸零，要沉回水下才恢復
  if (depth < 0.08) s.vent = 1; else if (depth > 0.45) s.vent = Math.max(0, s.vent - dt * 2.5);
  const surf = smooth(depth / 0.55) * (1 - s.vent) * s.boardDown;
  const cav = 1 - 0.55 * smooth((au - 24) / 4);            // 約 48 節以上開始空蝕，升力下降
  const aoa = s.rake + s.pitch * 0.8 - s.yV / vf;
  const CLf = clamp(5.2 * aoa, -0.4, 1.0) * cav;
  const qwu = 0.5 * 1025 * B.foilArea * u * au;
  const lift = Math.max(0, qwu) * CLf * surf;
  s.liftFrac = lift / (m * G);
  // 水翼與支柱阻力
  const immStrut = clamp(depth, 0, B.foilDepth);
  let Df = 0.5 * 1025 * u * au * (B.foilArea * surf * (0.007 + CLf * CLf / (Math.PI * 8 * 0.85)) + 0.3 * immStrut * 0.012 + 0.35 * 0.01);
  Df *= 1 + 1.6 * smooth((au - 24) / 4);
  Fx -= Df;
  // 船身入水時的阻力（細長船身，接近船速極限時急遽增加）與浮力
  const immT = immL + immR;
  const hullDrag = Math.min(m * 22, immT / 0.44 * (38 * u * au * (1 + Math.pow(au / 6.5, 4)) + 30 * u));
  Fx -= hullDrag;
  // 側向阻力：水翼支柱像一片垂直的翼，側滑時產生升力；船身入水時另加阻力
  const beta = Math.atan2(v, Math.max(au, 0.8));
  const latArea = 0.3 * immStrut * s.boardDown + 0.35 + immT * 3;
  const FyHull = -(0.5 * 1025 * latArea * 4.5 * Math.max(au, 0.8) ** 2 * clamp(beta, -0.25, 0.25) + 600 * v * Math.abs(v) * (immT > 0.05 ? 1 : 0.2));
  Fy += FyHull;

  // 縱向：升力 + 浮力 − 重力，船身入水時有阻尼
  const buoy = (immL + immR) * 1025 * G * 5.5;
  let Fz = lift * Math.cos(s.heel) + buoy - m * G - (immT > 0 ? 9000 * s.yV * Math.min(1, immT * 4) : 600 * s.yV);
  s.yV += Fz / m * dt;
  s.y += s.yV * dt;
  // 撞水：高速時船身重新入水 → 船頭下壓、猛烈減速
  if (s.foiling > 0.5 && immT > 0.25 && au > 8) { s.crash = 1; s.pitchV -= 0.9; }
  s.crash = Math.max(0, s.crash - dt);
  s.foiling += ((ride > 0.35 && s.liftFrac > 0.6 ? 1 : 0) - s.foiling) * Math.min(1, dt * 3);

  // 縱搖：飛行時保持接近水平（升降舵自動修正），在水中則跟著浪
  const bowUp = Math.atan2(bowW - water, 6.5);
  const pT = s.foiling > 0.5 ? 0.015 : bowUp * clamp(1 - ride, 0, 1);
  s.pitchV += ((pT - s.pitch) * 16 - 6 * s.pitchV) * dt; s.pitch += s.pitchV * dt;
  s.roll = 0; s.rollV = 0;

  const du = Fx / (m * 1.05), dv = Fy / (m * (immT > 0.05 ? 1.5 : 1.1));
  s.vx += (du * fx + dv * rx) * dt;
  s.vz += (du * fz + dv * rz) * dt;

  // 轉向：以全舵最小轉彎半徑描述，轉速 = 船速 / 半徑；低速時靠舵效不足轉很慢
  const rT = s.rudder * clamp(Math.max(au, 0.4) / B.rMin, 0, 0.5) * (immT > 0.1 ? 0.75 : 1);
  s.r += (rT - s.r) * Math.min(1, dt * 2.2) + (-FySail * 0.3 / B.yawI) * dt;
  s.psi = (s.psi + s.r * dt) % TAU; if (s.psi < 0) s.psi += TAU;

  // 橫傾：雙體船在一個船身抬離水面前幾乎不傾斜；
  // 扶正力矩上限 ≈ 重量 ×（下風水翼到重心的距離），超過就開始翻，而且越翻越快
  const arm = B.hullX + (s.foiling > 0.5 ? B.foilOut * 0.7 : 0);
  const Kmax = m * G * arm;
  const Mheel = -FySail * (B.ce + Math.max(ride, 0) + 1.2);
  const Mright = -Math.sign(s.heel) * Kmax * Math.min(1, Math.abs(s.heel) / 0.05) * Math.cos(s.heel);
  const M = Mheel + Mright - 60000 * s.heelV;
  s.heelV += M / B.heelI * dt;
  s.heel = clamp(s.heel + s.heelV * dt, -1.4, 1.4);
  if (Math.abs(s.heel) > 0.45) s.overheel += dt; else s.overheel = Math.max(0, s.overheel - dt * 2);

  const nx = s.x + s.vx * dt, nz = s.z + s.vz * dt;
  if (terrainHeight(nx + fx * 7, nz + fz * 7) > -1.5) { s.vx *= -0.2; s.vz *= -0.2; s.aground = 1.5; }
  else { s.x = nx; s.z = nz; }
  s.aground = Math.max(0, s.aground - dt);

  s.u = u; s.v = v; s.aws = aws; s.alpha = alpha; s.cl = CL; s.drive = Fx; s.side = Fy; s.deltaFree = deltaFree;
  s.ride = ride; s.heelLimit = Math.abs(Mheel) / Kmax;
  s.awa = Math.atan2(-Var, -Vaf);
  s.twa = Math.atan2(-W.x * rx - W.z * rz, -W.x * fx - W.z * fz);
  s.wind = W; s.leeway = beta;
  return s;
}
// 水翼船的建議帆角：帆翼迎角約 12°，快要翻的時候提早放帆
function idealSheetFoiler(s) {
  const lim = s.heelLimit || 0;
  const depower = clamp((lim - 0.75) * 1.6, 0, 0.9) + clamp((Math.abs(s.heel) - 0.05) * 5, 0, 0.6);
  return clamp(Math.abs(s.deltaFree) - 12 * D2R + depower, FOILER.sheetMin, FOILER.sheetMax);
}
if (typeof module !== 'undefined') Object.assign(module.exports, { FOILER, createFoilerState, stepFoiler, idealSheetFoiler });
