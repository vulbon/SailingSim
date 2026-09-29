// 用 Node.js 跑物理模型，印出各真風角的穩定船速（船速 ÷ 風速）。改物理參數後可以用來檢查。
// 用法：node tools/polar.js            （邊架艇）
//       node tools/polar.js foiler     （水翼雙體船）
const P = require('../src/physics.js');
const foiler = process.argv[2] === 'foiler';
for (const sea of ['calm', 'moderate', 'rough', 'storm']) {
  const S = P.SEA_STATES[sea];
  const env = { windBase: 42, windSpeed: S.wind, hs: S.hs, gustAmp: 0, dirVar: 0, waves: P.makeWaves(S.hs, 42) };
  let line = `${S.label.padEnd(5, '　')} 風 ${S.wind} m/s：`;
  for (const twa of [45, 60, 75, 90, 120, 150]) {
    const s = foiler ? P.createFoilerState() : P.createBoatState();
    s.x = 3000; s.z = -3000;
    const step = foiler ? P.stepFoiler : P.stepBoat, ideal = foiler ? P.idealSheetFoiler : P.idealSheet;
    let t = 0, sum = 0, n = 0, capsized = false;
    const dt = 1 / 120;
    for (let i = 0; i < 120 * 70; i++) {
      const w = P.windAt(env, t, s.x, s.z);
      const target = (w.dir + (t < 25 ? 100 : twa)) * P.D2R;   // 先橫風加速，再轉到指定角度
      const err = Math.atan2(Math.sin(target - s.psi), Math.cos(target - s.psi));
      step(s, env, { rudder: Math.max(-1, Math.min(1, err * 3 - s.r * 2)), sheetTarget: ideal(s) }, t, dt);
      t += dt;
      if (Math.abs(s.heel) > 1.1) { capsized = true; break; }
      if (i > 120 * 40) { sum += s.u; n++; }
    }
    line += capsized ? ` ${twa}°:翻船` : ` ${twa}°:${(sum / n / S.wind).toFixed(2)}×`;
  }
  console.log(line);
}
