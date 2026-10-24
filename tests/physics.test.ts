import { describe, expect, test } from 'vitest';
import { CABINET } from '../src/sim/cabinet';
import { type ClawTuning, SIZE_SCALE, defaultClawTuning } from '../src/sim/clawConfig';
import { getMujoco } from '../src/sim/mujoco';
import { antiSwingDirection, antiSwingProfile, armGeometry, rotateArm } from '../src/sim/mjcf';
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
    const long = await swingPeriod(tuning(), 0.35);
    // Effective length = cable + rope attachment → centre of mass (~6 cm).
    const expected = (L: number) => 2 * Math.PI * Math.sqrt((L + 0.06) / 9.81);
    expect(short / expected(0.2)).toBeGreaterThan(0.88);
    expect(short / expected(0.2)).toBeLessThan(1.12);
    expect(long / expected(0.35)).toBeGreaterThan(0.88);
    expect(long / expected(0.35)).toBeLessThan(1.12);
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
    // Resting on its tips: head centre ≈ arm reach (~20 cm) above the bed, far below where it hung.
    expect(sim.headPos()[2]).toBeLessThan(0.26);
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
    const rubber = await grab('plushSmall', 18, tuning((t) => (t.sleeve = 'rubber')));
    const metal = await grab('plushSmall', 18, tuning((t) => (t.sleeve = 'metal')));
    expect(rubber).toBeGreaterThan(0.2);
    expect(metal).toBeLessThan(0.1);
  });
});

describe('mechanical claw tuning', () => {
  test('spread sets the open tip radius', async () => {
    const tipRadius = async (t: ClawTuning) => {
      const sim = await ClawSimulation.create(t, []);
      sim.reset(0.3);
      const head = sim.headPos();
      const tip = sim.sitePos('arm0_tip');
      sim.dispose();
      return Math.hypot(tip[0] - head[0], tip[1] - head[1]);
    };
    const narrow = await tipRadius(tuning((t) => t.arms.forEach((a) => (a.spreadCm = 9))));
    const wide = await tipRadius(tuning((t) => t.arms.forEach((a) => (a.spreadCm = 15))));
    expect(wide - narrow).toBeGreaterThan(0.025);
  });
});

describe('JS claw shape', () => {
  test('arms are one continuous curved rod with no extra hook at the tip', async () => {
    const sim = await ClawSimulation.create(tuning(), []);
    const names = Array.from({ length: sim.model.ngeom }, (_, g) => sim.geomName(g));
    expect(names.some((n) => /hook|fin/.test(n))).toBe(false);
    sim.dispose();
    for (const size of ['small', 'medium', 'large'] as const) {
      const g = armGeometry(SIZE_SCALE[size], 12);
      // Neighbouring segments share their end points (the capsules form one rod).
      expect(g.points[0]).toEqual([0, 0]);
      // Open, the tip hangs well below the pivot and is the arm's lowest point (no upturned end).
      const open = rotateArm(g.points, g.openAngle);
      const tip = open[open.length - 1];
      expect(tip[1]).toBeLessThan(-0.1 * SIZE_SCALE[size]);
      expect(Math.min(...open.map((p) => p[1]))).toBe(tip[1]);
      // Closed, the three tips nearly meet.
      expect(g.hingeR + g.tip[0]).toBeLessThan(0.015 * SIZE_SCALE[size]);
    }
  });
});

describe('claw head and gantry', () => {
  test('short coil head, wide default spread, and nothing between gantry and plate', async () => {
    const t = tuning();
    expect(t.arms[0].spreadCm).toBeGreaterThanOrEqual(15);
    const sim = await ClawSimulation.create(t, []);
    sim.reset(0.3);
    const m = sim.model;
    const names = Array.from({ length: m.ngeom }, (_, g) => sim.geomName(g));
    expect(names).not.toContain('gantry_tube');
    const housing = names.indexOf('claw_housing');
    expect(2 * m.geom_size[housing * 3 + 1]).toBeLessThanOrEqual(0.04);
    // Hanging open, the tips sit on the set spread.
    const head = sim.headPos();
    const tip = sim.sitePos('arm0_tip');
    expect(2 * Math.hypot(tip[0] - head[0], tip[1] - head[1]) * 100).toBeCloseTo(t.arms[0].spreadCm, 0);
    sim.dispose();
  });
});

describe('防甩片 (anti-swing plate under the gantry)', () => {
  test('geometry: more concavity bends the plate further down; direction turns it', () => {
    const depth = (deg: number) => {
      const z = antiSwingProfile(deg).map((p) => p.z);
      return Math.max(...z) - Math.min(...z);
    };
    expect(depth(0)).toBeLessThan(0.001);
    expect(depth(40)).toBeGreaterThan(depth(20));
    expect(depth(40)).toBeGreaterThan(0.005);
    // The plate hangs right under the carriage (its bottom face is z = 0), nothing in between.
    for (const deg of [0, 20, 45]) {
      const top = Math.max(...antiSwingProfile(deg).map((p) => p.z));
      expect(top).toBeLessThan(0.001);
      expect(top).toBeGreaterThan(-0.01);
    }
    const [x0, y0] = antiSwingDirection(0);
    const [x90, y90] = antiSwingDirection(90);
    expect(x0).toBeCloseTo(0, 6);
    expect(y0).toBeCloseTo(-1, 6);
    expect(x90).toBeCloseTo(1, 6);
    expect(y90).toBeCloseTo(0, 6);
  });

  /** Raises an empty claw into the plate and returns the strongest sideways velocity of the head. */
  async function kick(concavityDeg: number, directionDeg: number): Promise<[number, number]> {
    const sim = await ClawSimulation.create(tuning((t) => (t.antiSwing = { concavityDeg, directionDeg })), []);
    sim.reset(0.3);
    moveGantry(sim, 0, 0);
    sim.setWinchVelocity(0.3);
    sim.step(0.6);
    sim.setWinchVelocity(0);
    sim.step(1.5);
    sim.setWinchVelocity(-0.29);
    let peak: [number, number] = [0, 0];
    for (let i = 0; i < 2000; i++) {
      sim.step(0.002);
      if (sim.cableLimit <= CABINET.ropeMin + 1e-4) sim.setWinchVelocity(0);
      const v = sim.headVel();
      if (Math.hypot(v[0], v[1]) > Math.hypot(...peak)) peak = [v[0], v[1]];
    }
    sim.dispose();
    return peak;
  }

  test('the claw hits the plate on the way up; concavity kicks it sideways in the set direction', async () => {
    const flat = await kick(0, 0);
    const bent = await kick(35, 0);
    expect(Math.hypot(...flat)).toBeLessThan(0.08);
    expect(Math.hypot(...bent)).toBeGreaterThan(0.25);
    for (const deg of [0, 90, 180, 270, 315]) {
      const v = await kick(35, deg);
      const [dx, dy] = antiSwingDirection(deg);
      expect((v[0] * dx + v[1] * dy) / Math.hypot(...v)).toBeGreaterThan(0.7);
    }
  });

  test('a held prize is flung faster with a bent plate, towards the set direction', async () => {
    /** Grabs a small plush, reels into the plate and lets go at the peak of the kick. */
    const fling = async (concavityDeg: number, directionDeg: number, aim: [number, number]) => {
      const t = tuning((c) => (c.antiSwing = { concavityDeg, directionDeg }));
      const sim = await ClawSimulation.create(t, [{ kind: 'plushSmall', pos: [0.05, 0.05, 0.08], yaw: 0.3, color: '#fff' }]);
      sim.reset(1.0);
      const b = sim.ids.prizeBodies[0] * 3;
      moveGantry(sim, sim.data.xpos[b] + aim[0], sim.data.xpos[b + 1] + aim[1]);
      sim.step(1.5);
      dropClaw(sim);
      sim.setClawVoltage(40);
      sim.step(0.08);
      raiseClaw(sim);
      // 上停上拉 into the plate; open the claw when the sideways kick peaks.
      sim.setWinchVelocity(-0.29);
      let best = 0;
      let bestAt = 0;
      for (let i = 0; i < 150; i++) {
        sim.step(0.002);
        const v = sim.headVel();
        const sp = Math.hypot(v[0], v[1]);
        if (sp > best) {
          best = sp;
          bestAt = i;
        }
        if (i - bestAt > 10 && best > 0.05) break;
      }
      const [dx, dy] = antiSwingDirection(directionDeg);
      // Prize velocity along the throw direction at the moment it is let go.
      const qv = sim.data.qvel;
      const pd = sim.ids.prizeDof[0];
      const launch = qv[pd] * dx + qv[pd + 1] * dy;
      sim.setWinchVelocity(0);
      sim.setClawVoltage(0);
      sim.step(2.5);
      const won = sim.remainingPrizes() === 0;
      const [gx, gy] = sim.gantryPos();
      const along = (sim.data.xpos[b] - gx) * dx + (sim.data.xpos[b + 1] - gy) * dy;
      sim.dispose();
      return { won, launch, along };
    };
    const aims: Array<[number, number]> = [
      [0.02, 0],
      [0, 0.02],
      [-0.02, 0],
    ];
    const run = async (c: number, d: number) => {
      const r = await Promise.all(aims.map((a) => fling(c, d, a)));
      const landed = r.filter((x) => !x.won);
      return {
        launch: r.reduce((x, y) => x + y.launch, 0) / r.length,
        along: landed.reduce((x, y) => x + y.along, 0) / landed.length,
      };
    };
    for (const d of [0, 90, 270]) {
      const flat = await run(0, d);
      const bent = await run(40, d);
      // Released faster along the set direction, and lands on that side on average.
      expect(bent.launch).toBeGreaterThan(flat.launch + 0.05);
      expect(bent.launch).toBeGreaterThan(0);
      expect(bent.along).toBeGreaterThan(0);
    }
  }, 180000);
});

describe('claw rebuild', () => {
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

describe('出貨口擋板 (chute guard)', () => {
  /** Shoves a box along the bed towards the chute and reports whether it fell in. */
  async function shove(guardCm: number) {
    const h = CABINET.hole;
    const y = (h.y0 + h.y1) / 2;
    const sim = await ClawSimulation.create(tuning(), [{ kind: 'cookieBox', pos: [h.x1 + 0.07, y, 0.025], yaw: 0, color: '#fff' }], guardCm / 100);
    let drops = 0;
    sim.events.onPrizeDrop = () => drops++;
    sim.reset(0.5);
    sim.data.qvel[sim.ids.prizeDof[0]] = -1.2;
    sim.step(2);
    const guards = Array.from({ length: sim.model.ngeom }, (_, g) => sim.geomName(g)).filter((n) => n.startsWith('guard_'));
    sim.dispose();
    return { drops, guards: guards.length };
  }

  test('a guard stops a prize pushed along the bed; without it the prize drops in', async () => {
    const guarded = await shove(7.5);
    const open = await shove(0);
    expect(guarded.guards).toBe(2);
    expect(guarded.drops).toBe(0);
    expect(open.guards).toBe(0);
    expect(open.drops).toBe(1);
  });

  test('changing the guard height rebuilds the wall and keeps prizes in place', async () => {
    const sim = await ClawSimulation.create(tuning(), [{ kind: 'cookieBox', pos: [0.1, 0.1, 0.03], yaw: 0.5, color: '#fff' }]);
    sim.reset(1.0);
    const b = sim.ids.prizeBodies[0] * 3;
    const before = Array.from(sim.data.xpos.slice(b, b + 3) as Float64Array);
    sim.setGuardHeight(0.12);
    let halfH = 0;
    for (let g = 0; g < sim.model.ngeom; g++) if (sim.geomName(g) === 'guard_side') halfH = sim.model.geom_size[g * 3 + 2];
    expect(halfH * 2).toBeCloseTo(0.12, 4);
    const b2 = sim.ids.prizeBodies[0] * 3;
    for (let k = 0; k < 3; k++) expect(sim.data.xpos[b2 + k]).toBeCloseTo(before[k], 2);
    sim.dispose();
  });
});

describe('檯面高度 (bed height)', () => {
  /** Drops the empty claw at the centre and returns the head z where the cable goes slack. */
  async function landingZ(bedH: number): Promise<number> {
    const sim = await ClawSimulation.create(tuning(), [], CABINET.guardH, bedH);
    sim.reset(0.3);
    moveGantry(sim, 0.1, 0);
    dropClaw(sim);
    const z = sim.headPos()[2];
    sim.dispose();
    return z;
  }

  test('the claw lands as much higher as the bed is raised', async () => {
    const low = await landingZ(0);
    const high = await landingZ(0.2);
    expect(high - low).toBeCloseTo(0.2, 2);
  });

  test('prizes are laid out on the raised bed and the chute still counts a drop', async () => {
    const h = CABINET.hole;
    const y = (h.y0 + h.y1) / 2;
    const sim = await ClawSimulation.create(tuning(), [{ kind: 'cookieBox', pos: [h.x1 + 0.07, y, 0.025], yaw: 0, color: '#fff' }], 0, 0.15);
    let drops = 0;
    sim.events.onPrizeDrop = () => drops++;
    sim.reset(0.5);
    // Resting on the raised bed (cookie box half height 0.025 above the bed top).
    expect(prizeZ(sim, 0)).toBeGreaterThan(0.15);
    expect(prizeZ(sim, 0)).toBeLessThan(0.15 + 0.04);
    sim.data.qvel[sim.ids.prizeDof[0]] = -1.2;
    sim.step(2);
    expect(drops).toBe(1);
    sim.dispose();
  });

  test('changing the bed height carries prizes along and clamps to the range', async () => {
    const sim = await ClawSimulation.create(tuning(), [{ kind: 'cookieBox', pos: [0.1, 0.1, 0.03], yaw: 0.5, color: '#fff' }]);
    sim.reset(1.0);
    const before = [0, 1, 2].map((k) => sim.data.xpos[sim.ids.prizeBodies[0] * 3 + k]);
    sim.setBedHeight(0.12);
    let top = 0;
    for (let g = 0; g < sim.model.ngeom; g++) if (sim.geomName(g) === 'floor_main') top = sim.model.geom_pos[g * 3 + 2] + sim.model.geom_size[g * 3 + 2];
    expect(top).toBeCloseTo(0.12, 4);
    const b = sim.ids.prizeBodies[0] * 3;
    expect(sim.data.xpos[b]).toBeCloseTo(before[0], 2);
    expect(sim.data.xpos[b + 1]).toBeCloseTo(before[1], 2);
    expect(sim.data.xpos[b + 2] - before[2]).toBeCloseTo(0.12, 2);
    sim.setBedHeight(5);
    expect(sim.bedH).toBe(CABINET.bedRange[1]);
    sim.dispose();
  });
});
