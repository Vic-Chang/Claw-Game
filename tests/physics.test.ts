import { describe, expect, test } from 'vitest';
import { CABINET } from '../src/sim/cabinet';
import { type ClawTuning, defaultClawTuning } from '../src/sim/clawConfig';
import { getMujoco } from '../src/sim/mujoco';
import type { PrizeKind, PrizePlacement } from '../src/sim/prizes';
import { ClawSimulation } from '../src/sim/simulation';
import { COIL_TAU, Solenoid, torqueAtVoltage } from '../src/sim/solenoid';
import { dropClaw, moveGantry, prizeZ, raiseClaw } from './helpers';

function tuning(f: (t: ClawTuning) => void = () => {}): ClawTuning {
  const t = defaultClawTuning();
  f(t);
  return t;
}

/** Lowers the claw to cable length L, kicks the gantry, and measures the swing period. */
async function swingPeriod(t: ClawTuning, L: number): Promise<number> {
  const sim = await ClawSimulation.create(t, []);
  sim.reset(0.3);
  moveGantry(sim, 0, 0);
  sim.setWinchVelocity(0.3);
  while (sim.cableLimit < L) sim.step(0.002);
  sim.setWinchVelocity(0);
  sim.step(1.5);
  sim.setGantryVelocity(0.15, 0);
  sim.step(0.15);
  sim.setGantryVelocity(0, 0);
  sim.step(0.5);
  const crossings: number[] = [];
  let prev = sim.headPos()[0] - sim.gantryPos()[0];
  for (let i = 0; i < 4000 && crossings.length < 5; i++) {
    sim.step(0.002);
    const off = sim.headPos()[0] - sim.gantryPos()[0];
    if (prev < 0 && off >= 0) crossings.push(sim.time);
    prev = off;
  }
  sim.dispose();
  return (crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1);
}

async function grab(kind: PrizeKind, volts: number, t: ClawTuning, aim: [number, number] = [0.02, 0], yaw = 0.3) {
  const prize: PrizePlacement = { kind, pos: [0.05, 0, 0.08], yaw, color: '#fff' };
  const sim = await ClawSimulation.create(t, [prize]);
  sim.reset(1.0);
  const b = sim.ids.prizeBodies[0] * 3;
  moveGantry(sim, sim.data.xpos[b] + aim[0], sim.data.xpos[b + 1] + aim[1]);
  sim.step(1.5);
  dropClaw(sim);
  sim.setClawVoltage(volts);
  sim.step(0.08);
  raiseClaw(sim);
  sim.step(1.0);
  const z = prizeZ(sim, 0);
  sim.dispose();
  return z;
}

describe('MuJoCo engine sanity', () => {
  test('Coulomb friction: a box slides once the slope exceeds atan(μ)', async () => {
    const mj = await getMujoco();
    const slides = (deg: number) => {
      const a = (deg * Math.PI) / 180;
      const xml = `<mujoco><compiler angle="radian"/><option timestep="0.002" cone="elliptic"/><worldbody>
        <geom type="plane" size="1 1 0.1" euler="0 ${a} 0" friction="0.1 0.005 0.0001"/>
        <body pos="0 0 0.03" euler="0 ${a} 0"><freejoint/><geom type="box" size="0.05 0.034 0.024" mass="0.11" friction="0.42 0.005 0.0001" condim="4"/></body>
        </worldbody></mujoco>`;
      const m = mj.MjModel.from_xml_string(xml);
      const d = new mj.MjData(m);
      for (let i = 0; i < 1000; i++) mj.mj_step(m, d);
      const x = Math.hypot(d.qpos[0], d.qpos[1]);
      d.delete();
      m.delete();
      return x > 0.02;
    };
    // Cardboard μ = 0.42 → critical angle ≈ 22.8°.
    expect(slides(19)).toBe(false);
    expect(slides(27)).toBe(true);
  });
});

describe('claw solenoid', () => {
  test('grip torque rises with voltage and saturates', () => {
    const t = [0, 12, 24, 36, 48].map((v) => torqueAtVoltage(v));
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
    // Pull ∝ I² at low current, but the iron saturates: doubling 24 → 48 V gives < 4×.
    expect(t[2] / t[1]).toBeGreaterThan(3.3);
    expect(t[4] / t[2]).toBeLessThan(3);
  });

  test('coil current follows a voltage step with the L/R time constant', () => {
    const s = new Solenoid();
    s.setVoltage(48);
    const steps = Math.round(COIL_TAU / 0.001);
    for (let i = 0; i < steps; i++) s.step(0.001);
    const target = 48 / 16;
    expect(s.current / target).toBeGreaterThan(0.6);
    expect(s.current / target).toBeLessThan(0.66);
  });
});

describe('cable & swing (甩動)', () => {
  test('the claw swings like a pendulum: T ≈ 2π√(L/g), longer cable → slower', async () => {
    const short = await swingPeriod(tuning(), 0.2);
    const long = await swingPeriod(tuning(), 0.45);
    // Effective length = cable + rope attachment → centre of mass (~6 cm).
    const expected = (L: number) => 2 * Math.PI * Math.sqrt((L + 0.06) / 9.81);
    expect(short / expected(0.2)).toBeGreaterThan(0.88);
    expect(short / expected(0.2)).toBeLessThan(1.12);
    expect(long / expected(0.45)).toBeGreaterThan(0.88);
    expect(long / expected(0.45)).toBeLessThan(1.12);
    expect(long).toBeGreaterThan(short);
  });

  test('a bigger claw is heavier and swings with a longer period', async () => {
    const small = await swingPeriod(tuning((t) => (t.size = 'small')), 0.3);
    const large = await swingPeriod(tuning((t) => (t.size = 'large')), 0.3);
    expect(large).toBeGreaterThan(small);
  });

  test('the cable goes slack when the claw lands (can only pull, not push)', async () => {
    const sim = await ClawSimulation.create(tuning(), []);
    sim.reset(0.3);
    moveGantry(sim, 0.1, 0.05);
    sim.setWinchVelocity(0.3);
    for (let t = 0; t < 3; t += 0.01) sim.step(0.01);
    sim.setWinchVelocity(0);
    expect(sim.cableSlack).toBeGreaterThan(0.05);
    expect(sim.headPos()[2]).toBeLessThan(0.2);
    sim.dispose();
  });
});

describe('grasping', () => {
  test('a well-aimed 48 V grab lifts a small plush; 14 V and 0 V cannot hold it', async () => {
    expect(await grab('plushSmall', 48, tuning())).toBeGreaterThan(0.2);
    expect(await grab('plushSmall', 14, tuning())).toBeLessThan(0.1);
    expect(await grab('plushSmall', 0, tuning())).toBeLessThan(0.1);
  });

  test('sleeve friction matters: rubber holds where bare metal slips', async () => {
    const rubber = await grab('plushSmall', 26, tuning((t) => (t.sleeve = 'rubber')));
    const metal = await grab('plushSmall', 26, tuning((t) => (t.sleeve = 'metal')));
    expect(rubber).toBeGreaterThan(0.2);
    expect(metal).toBeLessThan(0.1);
  });
});

describe('mechanical claw tuning', () => {
  test('spread sets the open tip radius; fin concavity lifts the fin end; direction yaws it', async () => {
    const tipInfo = async (t: ClawTuning) => {
      const sim = await ClawSimulation.create(t, []);
      sim.reset(0.3);
      const head = sim.headPos();
      const tip = sim.sitePos('arm0_tip');
      const m = sim.model;
      let fin: number[] = [];
      for (let g = 0; g < m.ngeom; g++) if (sim.geomName(g) === 'arm0_fin2') fin = Array.from(sim.data.geom_xpos.slice(g * 3, g * 3 + 3) as Float64Array);
      sim.dispose();
      return { radius: Math.hypot(tip[0] - head[0], tip[1] - head[1]), finRise: fin[2] - tip[2], finX: fin[0] - tip[0] };
    };
    const narrow = await tipInfo(tuning((t) => t.arms.forEach((a) => (a.spreadCm = 9))));
    const wide = await tipInfo(tuning((t) => t.arms.forEach((a) => (a.spreadCm = 15))));
    expect(wide.radius - narrow.radius).toBeGreaterThan(0.025);
    const flat = await tipInfo(tuning((t) => t.arms.forEach((a) => (a.finConcavityDeg = 0))));
    const cup = await tipInfo(tuning((t) => t.arms.forEach((a) => (a.finConcavityDeg = 40))));
    expect(cup.finRise).toBeGreaterThan(flat.finRise + 0.004);
    const left = await tipInfo(tuning((t) => t.arms.forEach((a) => (a.finDirectionDeg = -25))));
    const right = await tipInfo(tuning((t) => t.arms.forEach((a) => (a.finDirectionDeg = 25))));
    // Arm 0 points to +y; yawing its fin moves the fin end sideways in x.
    expect(Math.sign(left.finX)).not.toBe(Math.sign(right.finX));
  });

  test('anti-swing fins change how a prize is thrown in a 頓甩', async () => {
    const fling = async (conc: number, dir: number) => {
      const t = tuning((c) => c.arms.forEach((a) => Object.assign(a, { finConcavityDeg: conc, finDirectionDeg: dir })));
      const sim = await ClawSimulation.create(t, [{ kind: 'plushSmall', pos: [0.05, 0, 0.08], yaw: 0.3, color: '#fff' }]);
      sim.reset(1.0);
      const b = sim.ids.prizeBodies[0] * 3;
      moveGantry(sim, sim.data.xpos[b] + 0.02, sim.data.xpos[b + 1]);
      sim.step(1.5);
      dropClaw(sim);
      sim.setClawVoltage(40);
      sim.step(0.08);
      raiseClaw(sim);
      sim.setGantryVelocity(-0.25, 0);
      sim.step(0.5);
      sim.setGantryVelocity(0, 0);
      sim.setClawVoltage(8);
      sim.step(2);
      const p = [sim.data.xpos[b], sim.data.xpos[b + 1]];
      sim.dispose();
      return p;
    };
    const a = await fling(0, 0);
    const b = await fling(40, 25);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(0.02);
  });

  test('rebuilding for new claw geometry keeps prizes where they were', async () => {
    const sim = await ClawSimulation.create(tuning(), [{ kind: 'cookieBox', pos: [0.1, 0.1, 0.03], yaw: 0.5, color: '#fff' }]);
    sim.reset(1.0);
    const b = sim.ids.prizeBodies[0] * 3;
    const before = Array.from(sim.data.xpos.slice(b, b + 3) as Float64Array);
    sim.setClawTuning(tuning((t) => (t.size = 'large')));
    const b2 = sim.ids.prizeBodies[0] * 3;
    const after = Array.from(sim.data.xpos.slice(b2, b2 + 3) as Float64Array);
    for (let k = 0; k < 3; k++) expect(after[k]).toBeCloseTo(before[k], 2);
    sim.dispose();
  });
});

describe('chute electric eye (落物電眼)', () => {
  test('a prize falling into the chute is detected once and then removed', async () => {
    const h = CABINET.hole;
    const sim = await ClawSimulation.create(tuning(), [{ kind: 'cookieBox', pos: [(h.x0 + h.x1) / 2, (h.y0 + h.y1) / 2, 0.15], yaw: 0, color: '#fff' }]);
    let drops = 0;
    sim.events.onPrizeDrop = () => drops++;
    sim.reset(0);
    sim.step(3);
    expect(drops).toBe(1);
    expect(sim.remainingPrizes()).toBe(0);
    expect(prizeZ(sim, 0)).toBeLessThan(-2);
    sim.dispose();
  });
});
