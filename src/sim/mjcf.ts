import { CABINET } from './cabinet';
import { type ClawTuning, SIZE_SCALE, sleeveSpec } from './clawConfig';
import { PRIZE_KINDS, type PrizePlacement } from './prizes';

/**
 * Builds the MuJoCo MJCF model of the whole machine. Geometry that depends on the
 * mechanical claw tuning (size, spread, anti-swing fins) is baked into the XML, so
 * changing those means regenerating the model; voltages, speeds and friction are
 * changed at runtime on the compiled model.
 */

export const ARM_COUNT = 3;
/** Arm 0 points to the back (+y); the others follow counter-clockwise. */
export const ARM_ANGLES = [90, 210, 330].map((d) => (d * Math.PI) / 180);

/** Geometry of one claw arm in its local frame (x radial outward, z up), metres. */
export interface ArmGeometry {
  scale: number;
  /** Hinge offset from the head axis. */
  hingeR: number;
  hingeZ: number;
  elbow: [number, number];
  tip: [number, number];
  /** Hinge angle (rad) at full open. */
  openAngle: number;
  /** Distance hinge → tip (lever arm for the closing torque). */
  lever: number;
}

export function armGeometry(scale: number, spreadCm: number): ArmGeometry {
  const hingeR = 0.03 * scale;
  const elbow: [number, number] = [0.03 * scale, -0.065 * scale];
  const tip: [number, number] = [-0.006 * scale, -0.125 * scale];
  const target = spreadCm / 200;
  // Opening rotates the arm outward about the tangential axis: x' = x cos q − z sin q.
  const tipRadius = (q: number) => hingeR + tip[0] * Math.cos(q) - tip[1] * Math.sin(q);
  let lo = 0;
  let hi = 1.4;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (tipRadius(mid) < target) lo = mid;
    else hi = mid;
  }
  return {
    scale,
    hingeR,
    hingeZ: -0.035 * scale,
    elbow,
    tip,
    openAngle: (lo + hi) / 2,
    lever: Math.hypot(tip[0], tip[1]),
  };
}

const f = (n: number) => (Math.abs(n) < 1e-9 ? '0' : n.toFixed(5).replace(/0+$/, '').replace(/\.$/, ''));
const v = (...ns: number[]) => ns.map(f).join(' ');

function hexToRgba(hex: string, a = 1): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return v(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a);
}

/** Contact softness of plush (cotton stuffing). Tunable for calibration. */
export const PLUSH_CONTACT = { solref: '0.012 1', solimp: '0.8 0.95 0.008 0.5 2' };

/** Head spring constant (N·m/rad) that opens the claw when the solenoid is off. */
export const ARM_SPRING = 0.025;
export const ARM_SPRING_PRELOAD = 0.65;

function clawXml(t: ClawTuning): string {
  const s = SIZE_SCALE[t.size];
  const sleeve = sleeveSpec(t);
  const headMass = 0.3 * s ** 3;
  const armMass = 0.028 * s ** 3;
  const out: string[] = [];
  out.push(`<body name="claw_head" pos="${v(CABINET.home.x, CABINET.home.y, CABINET.gantryZ - 0.02 - CABINET.ropeTop - 0.044 * s)}">`);
  out.push(`<joint name="claw_free" type="free" damping="0.1"/>`);
  out.push(`<geom name="claw_housing" priority="1" type="cylinder" size="${v(0.03 * s, 0.035 * s)}" mass="${f(headMass * 0.8)}" rgba="0.85 0.2 0.55 1" contype="3" conaffinity="3" friction="0.3 0.003 0.0001"/>`);
  out.push(`<geom name="claw_cap" priority="1" type="cylinder" pos="${v(0, 0, 0.038 * s)}" size="${v(0.014 * s, 0.006 * s)}" mass="${f(headMass * 0.1)}" rgba="0.75 0.75 0.78 1" contype="3" conaffinity="3"/>`);
  out.push(`<geom name="claw_ring" priority="1" type="cylinder" pos="${v(0, 0, -0.03 * s)}" size="${v(0.036 * s, 0.006 * s)}" mass="${f(headMass * 0.1)}" rgba="0.6 0.6 0.65 1" contype="1" conaffinity="1"/>`);
  out.push(`<site name="rope_bot" pos="${v(0, 0, 0.044 * s)}" size="0.003"/>`);

  for (let i = 0; i < ARM_COUNT; i++) {
    const a = t.arms[i];
    const g = armGeometry(s, a.spreadCm);
    const phi = ARM_ANGLES[i];
    const [ex, ez] = g.elbow;
    const [tx, tz] = g.tip;
    const sl = 0.55;
    const sx = ex + (tx - ex) * sl;
    const sz = ez + (tz - ez) * sl;
    out.push(`<body name="arm${i}" pos="${v(g.hingeR * Math.cos(phi), g.hingeR * Math.sin(phi), g.hingeZ)}" euler="0 0 ${f(phi)}">`);
    out.push(
      `<joint name="arm${i}_hinge" type="hinge" axis="0 -1 0" range="${v(-0.02, g.openAngle)}" limited="true" ` +
        `stiffness="${f(ARM_SPRING)}" springref="${f(g.openAngle + ARM_SPRING_PRELOAD)}" damping="0.0015" armature="0.00005"/>`,
    );
    out.push(`<geom name="arm${i}_upper" priority="1" type="capsule" fromto="${v(0, 0, 0, ex, 0, ez)}" size="${f(0.0045 * s)}" mass="${f(armMass * 0.45)}" rgba="0.82 0.82 0.86 1" friction="0.3 0.003 0.0001"/>`);
    out.push(`<geom name="arm${i}_lower" priority="1" type="capsule" fromto="${v(ex, 0, ez, sx, 0, sz)}" size="${f(0.004 * s)}" mass="${f(armMass * 0.25)}" rgba="0.82 0.82 0.86 1" friction="0.3 0.003 0.0001"/>`);
    out.push(
      `<geom name="arm${i}_sleeve" priority="1" type="capsule" fromto="${v(sx, 0, sz, tx, 0, tz)}" size="${f(0.0062 * s)}" mass="${f(armMass * 0.15)}" ` +
        `rgba="0.15 0.15 0.15 1" condim="6" friction="${v(...sleeve.friction)}" solref="${v(sleeve.solrefTime, 1)}"/>`,
    );
    // Anti-swing fin (防甩片): a curved metal tab at the tip, cupped upward by `finConcavityDeg`
    // and yawed about the arm by `finDirectionDeg`.
    const segs = 3;
    const segLen = 0.0055 * s;
    const halfW = 0.0075 * s;
    const conc = (a.finConcavityDeg * Math.PI) / 180;
    let px = 0;
    let pz = 0;
    out.push(`<frame pos="${v(tx, 0, tz)}" euler="${v(0, 0, (a.finDirectionDeg * Math.PI) / 180)}">`);
    for (let k = 0; k < segs; k++) {
      const ang = (conc * (k + 1)) / segs;
      const dx = -Math.cos(ang);
      const dz = Math.sin(ang);
      const cx = px + (dx * segLen) / 2;
      const cz = pz + (dz * segLen) / 2;
      out.push(
        `<geom name="arm${i}_fin${k}" priority="1" type="box" pos="${v(cx, 0, cz)}" euler="${v(0, ang, 0)}" size="${v(segLen / 2, halfW, 0.0012 * s)}" ` +
          `mass="${f((armMass * 0.15) / segs)}" rgba="0.9 0.9 0.94 1" friction="0.3 0.003 0.0001"/>`,
      );
      px += dx * segLen;
      pz += dz * segLen;
    }
    out.push(`</frame>`);
    out.push(`<site name="arm${i}_tip" pos="${v(tx, 0, tz)}" size="0.002"/>`);
    out.push(`</body>`);
  }
  out.push(`</body>`);
  return out.join('\n');
}

function prizeXml(p: PrizePlacement, i: number): string {
  const spec = PRIZE_KINDS[p.kind];
  const quat = p.quat ?? [Math.cos(p.yaw / 2), 0, 0, Math.sin(p.yaw / 2)];
  const head = `<body name="prize${i}" pos="${v(...p.pos)}" quat="${v(...quat)}"><freejoint name="prize${i}_free"/>`;
  const rgba = hexToRgba(p.color);
  switch (p.kind) {
    case 'cookieBox':
    case 'tissueBox': {
      const [hx, hy, hz] = spec.half;
      return (
        head +
        `<geom name="prize${i}_box" type="box" size="${v(hx, hy, hz)}" mass="${f(spec.mass)}" rgba="${rgba}" friction="0.42 0.005 0.0001" condim="4"/>` +
        `</body>`
      );
    }
    case 'bottle':
      return (
        head +
        `<geom name="prize${i}_bottle" type="cylinder" size="0.03 0.058" mass="${f(spec.mass * 0.95)}" rgba="0.75 0.9 1 0.55" friction="0.35 0.004 0.0001" condim="4"/>` +
        `<geom name="prize${i}_neck" type="cylinder" pos="0 0 0.066" size="0.013 0.01" mass="${f(spec.mass * 0.05)}" rgba="0.95 0.3 0.3 1" friction="0.35 0.004 0.0001" condim="4"/>` +
        `</body>`
      );
    case 'plushSmall':
    case 'plushMedium': {
      const k = p.kind === 'plushSmall' ? 0.78 : 1;
      const m = spec.mass;
      const soft = `solref="${PLUSH_CONTACT.solref}" solimp="${PLUSH_CONTACT.solimp}" friction="0.85 0.01 0.0006" condim="6"`;
      const joint = (name: string, pos: number[]) =>
        `<joint name="${name}" type="ball" pos="${v(...pos)}" stiffness="${f(0.03 * k)}" damping="${f(0.0025 * k)}"/>`;
      const deco = `contype="0" conaffinity="0" group="2" mass="0"`;
      return (
        head +
        `<geom name="prize${i}_torso" type="ellipsoid" size="${v(0.042 * k, 0.034 * k, 0.04 * k)}" mass="${f(m * 0.42)}" rgba="${rgba}" ${soft}/>` +
        `<body name="prize${i}_head" pos="${v(0, 0, 0.068 * k)}">${joint(`prize${i}_neck`, [0, 0, -0.025 * k])}` +
        `<geom name="prize${i}_headball" type="sphere" size="${f(0.036 * k)}" mass="${f(m * 0.3)}" rgba="${rgba}" ${soft}/>` +
        `<geom name="prize${i}_earL" type="sphere" pos="${v(-0.024 * k, 0, 0.03 * k)}" size="${f(0.012 * k)}" mass="${f(m * 0.02)}" rgba="${rgba}" ${soft}/>` +
        `<geom name="prize${i}_earR" type="sphere" pos="${v(0.024 * k, 0, 0.03 * k)}" size="${f(0.012 * k)}" mass="${f(m * 0.02)}" rgba="${rgba}" ${soft}/>` +
        `<geom name="prize${i}_eyeL" type="sphere" pos="${v(-0.012 * k, -0.032 * k, 0.006 * k)}" size="${f(0.0045 * k)}" rgba="0.08 0.08 0.1 1" ${deco}/>` +
        `<geom name="prize${i}_eyeR" type="sphere" pos="${v(0.012 * k, -0.032 * k, 0.006 * k)}" size="${f(0.0045 * k)}" rgba="0.08 0.08 0.1 1" ${deco}/>` +
        `<geom name="prize${i}_nose" type="sphere" pos="${v(0, -0.035 * k, -0.006 * k)}" size="${f(0.004 * k)}" rgba="0.9 0.45 0.5 1" ${deco}/>` +
        `</body>` +
        [
          ['armL', [-0.045 * k, 0, 0.012 * k], [-0.02 * k, 0, -0.012 * k]],
          ['armR', [0.045 * k, 0, 0.012 * k], [0.02 * k, 0, -0.012 * k]],
          ['legL', [-0.022 * k, -0.006 * k, -0.038 * k], [0, -0.012 * k, -0.018 * k]],
          ['legR', [0.022 * k, -0.006 * k, -0.038 * k], [0, -0.012 * k, -0.018 * k]],
        ]
          .map(
            ([name, pos, dir]) =>
              `<body name="prize${i}_${name}" pos="${v(...(pos as number[]))}">${joint(`prize${i}_${name}_j`, [0, 0, 0])}` +
              `<geom name="prize${i}_${name}g" type="capsule" fromto="${v(0, 0, 0, ...(dir as number[]))}" size="${f(0.012 * k)}" mass="${f(m * 0.06)}" rgba="${rgba}" ${soft}/></body>`,
          )
          .join('') +
        `</body>`
      );
    }
  }
}

function cabinetXml(guardH: number): string {
  const { halfW: W, halfD: D, wallH, hole, guardT } = CABINET;
  const T = 0.02;
  const box = (name: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, extra = '') =>
    `<geom name="${name}" type="box" pos="${v((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)}" size="${v((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2)}" ${extra}/>`;
  const floor = `rgba="0.98 0.6 0.78 1" friction="0.6 0.005 0.0002"`;
  const glass = `rgba="0.8 0.9 1 0.12" friction="0.2 0.002 0.0001"`;
  const acrylic = `rgba="0.85 0.95 1 0.3" friction="0.25 0.002 0.0001"`;
  const chute = `rgba="0.25 0.25 0.3 1" friction="0.3 0.003 0.0001"`;
  return [
    // Prize bed (plush fabric) with the chute cut out of the front-left corner.
    box('floor_main', hole.x1, W, -D, D, -T, 0, floor),
    box('floor_back', -W, hole.x1, hole.y1, D, -T, 0, floor),
    // Glass walls.
    box('glass_left', -W - 0.01, -W, -D, D, -0.3, wallH, glass),
    box('glass_right', W, W + 0.01, -D, D, -0.3, wallH, glass),
    box('glass_back', -W, W, D, D + 0.01, -0.3, wallH, glass),
    box('glass_front', -W, W, -D - 0.01, -D, 0, wallH, glass),
    // Acrylic guard around the chute (防護擋板); the operator sets its height, 0 removes it.
    ...(guardH > 0.001
      ? [
          box('guard_side', hole.x1, hole.x1 + guardT, hole.y0, hole.y1 + guardT, 0, guardH, acrylic),
          box('guard_back', hole.x0, hole.x1 + guardT, hole.y1, hole.y1 + guardT, 0, guardH, acrylic),
        ]
      : []),
    // Chute shaft and the sloped slide to the pickup door.
    box('chute_front', hole.x0, hole.x1, hole.y0 - 0.01, hole.y0, -0.3, 0, chute),
    box('chute_inner', hole.x1, hole.x1 + 0.01, hole.y0, hole.y1, -0.3, -T, chute),
    box('chute_back', hole.x0, hole.x1, hole.y1, hole.y1 + 0.01, -0.3, -T, chute),
    `<geom name="chute_slide" type="box" pos="${v((hole.x0 + hole.x1) / 2, (hole.y0 + hole.y1) / 2, -0.28)}" size="${v((hole.x1 - hole.x0) / 2, (hole.y1 - hole.y0) / 2, 0.01)}" euler="-0.35 0 0" ${chute}/>`,
    // Out-of-play storage shelf for prizes that were won.
    `<geom name="storage" type="plane" pos="0 0 -3" size="5 5 0.1" rgba="0 0 0 0"/>`,
  ].join('\n');
}

export interface MjcfOptions {
  claw: ClawTuning;
  prizes: PrizePlacement[];
  /** Chute guard height in metres (default CABINET.guardH). */
  guardH?: number;
  timestep?: number;
}

export function buildMjcf(opts: MjcfOptions): string {
  const { claw, prizes } = opts;
  const { travel, gantryZ } = CABINET;
  const s = SIZE_SCALE[claw.size];
  return `<mujoco model="feiluoli-standard">
<compiler angle="radian" autolimits="true"/>
<option timestep="${f(opts.timestep ?? 0.002)}" integrator="implicitfast" cone="elliptic" impratio="4" iterations="60" ls_iterations="20" gravity="0 0 -9.81"/>
<size memory="64M"/>
<default>
  <geom contype="1" conaffinity="1" condim="4" solref="0.004 1" solimp="0.9 0.97 0.001"/>
</default>
<worldbody>
${cabinetXml(opts.guardH ?? CABINET.guardH)}
<body name="gantry" pos="${v(0, 0, gantryZ)}">
  <joint name="gantry_x" type="slide" axis="1 0 0" range="${v(travel.x0, travel.x1)}" damping="4" armature="0.05"/>
  <joint name="gantry_y" type="slide" axis="0 1 0" range="${v(travel.y0, travel.y1)}" damping="4" armature="0.05"/>
  <geom name="gantry_carriage" type="box" pos="0 0 0.03" size="0.06 0.05 0.03" mass="2.2" rgba="0.95 0.8 0.15 1" contype="0" conaffinity="0"/>
  <geom name="gantry_tube" type="cylinder" pos="${v(0, 0, -0.065)}" size="${v(0.022 * Math.max(1, s), 0.025)}" mass="0.05" rgba="0.95 0.8 0.15 1" contype="2" conaffinity="2"/>
  <site name="pulley" pos="0 0 -0.02" size="0.004"/>
</body>
${clawXml(claw)}
${prizes.map(prizeXml).join('\n')}
</worldbody>
<tendon>
  <spatial name="cable" limited="true" range="${v(0, CABINET.ropeTop)}" width="0.0012" rgba="0.2 0.2 0.22 1" solreflimit="0.006 1" damping="0.4">
    <site site="pulley"/><site site="rope_bot"/>
  </spatial>
</tendon>
<actuator>
  <velocity name="motor_x" joint="gantry_x" kv="120" forcerange="-28 28"/>
  <velocity name="motor_y" joint="gantry_y" kv="120" forcerange="-28 28"/>
  ${[0, 1, 2].map((i) => `<motor name="solenoid${i}" joint="arm${i}_hinge" gear="1" ctrlrange="-1 1"/>`).join('\n  ')}
</actuator>
</mujoco>`;
}
