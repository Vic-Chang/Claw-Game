import { CABINET } from './cabinet';
import { type ClawTuning, SIZE_SCALE, sleeveSpec } from './clawConfig';
import { PRIZE_KINDS, type PrizePlacement } from './prizes';

/**
 * Builds the MuJoCo MJCF model of the whole machine. Geometry that depends on the
 * mechanical claw tuning (size, spread, anti-swing plate) is baked into the XML, so
 * changing those means regenerating the model; voltages, speeds and friction are
 * changed at runtime on the compiled model.
 */

export const ARM_COUNT = 3;
/** Arm 0 points to the back (+y); the others follow counter-clockwise. */
export const ARM_ANGLES = [90, 210, 330].map((d) => (d * Math.PI) / 180);

/** JS claw head dimensions at scale 1 (metres): slim coil housing, plunger rod and hub. */
export const HEAD = {
  radius: 0.025,
  /** A short coil section, about 3 cm tall. */
  halfHeight: 0.016,
  /** Cable attachment above the head centre (top of the cap). */
  ropeOffset: 0.023,
  /** Hub carrying the arm pivots, below the housing. */
  hubZ: -0.04,
  hingeR: 0.015,
};

/**
 * Arm shape from photos of a real JS claw, open as it hangs (x radial outward, z up, hinge
 * at the origin): one continuous bent rod — out from the hub, a smooth curve down, then
 * almost straight down with the tip turned in only slightly. No extra hook at the end.
 */
const ARM_SHAPE: Array<[number, number]> = [
  [0, 0],
  [0.022, -0.006],
  [0.04, -0.02],
  [0.05, -0.042],
  [0.053, -0.07],
  [0.05, -0.1],
  [0.044, -0.125],
];
/** Tip distance from the claw axis when fully closed: the three tips nearly touch. */
const CLOSED_TIP_RADIUS = 0.009;

/** Geometry of one claw arm in its local frame (x radial outward, z up), metres. */
export interface ArmGeometry {
  scale: number;
  /** Hinge offset from the head axis. */
  hingeR: number;
  hingeZ: number;
  /** Rod centre line in the closed pose (hinge angle 0), hinge first, tip last. */
  points: Array<[number, number]>;
  tip: [number, number];
  /** Hinge angle (rad) at full open. */
  openAngle: number;
  /** Distance hinge → tip (lever arm for the closing torque). */
  lever: number;
}

/** Rotates arm points about the hinge; + swings the tip outward (opens). */
export function rotateArm(points: Array<[number, number]>, q: number): Array<[number, number]> {
  const c = Math.cos(q);
  const sn = Math.sin(q);
  return points.map(([x, z]) => [x * c - z * sn, x * sn + z * c]);
}

function solveAngle(radius: (q: number) => number, target: number, lo: number, hi: number): number {
  // radius() grows with q over the search range.
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (radius(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function armGeometry(scale: number, spreadCm: number): ArmGeometry {
  const hingeR = HEAD.hingeR * scale;
  const shape = ARM_SHAPE.map(([x, z]) => [x * scale, z * scale] as [number, number]);
  const tipRadius = (pts: Array<[number, number]>, q: number) => hingeR + rotateArm([pts[pts.length - 1]], q)[0][0];
  // Closed pose: swing the photographed shape inward until the tips nearly meet.
  const close = solveAngle((q) => tipRadius(shape, q), CLOSED_TIP_RADIUS * scale, -1.2, 0);
  const points = rotateArm(shape, close);
  const openAngle = solveAngle((q) => tipRadius(points, q), spreadCm / 200, 0, 1.6);
  const tip = points[points.length - 1];
  return { scale, hingeR, hingeZ: HEAD.hubZ * scale, points, tip, openAngle, lever: Math.hypot(tip[0], tip[1]) };
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
  const metal = 'friction="0.3 0.003 0.0001"';
  const black = 'rgba="0.1 0.1 0.11 1"';
  const gold = 'rgba="0.93 0.68 0.12 1"';
  const out: string[] = [];
  out.push(`<body name="claw_head" pos="${v(CABINET.home.x, CABINET.home.y, CABINET.gantryZ + CABINET.pulleyZ - CABINET.ropeTop - HEAD.ropeOffset * s)}">`);
  out.push(`<joint name="claw_free" type="free" damping="0.1"/>`);
  // Short coil housing with its clamp ring, the cap the cable is tied to, the plunger rod and the hub.
  out.push(`<geom name="claw_housing" priority="1" type="cylinder" size="${v(HEAD.radius * s, HEAD.halfHeight * s)}" mass="${f(headMass * 0.72)}" ${black} contype="3" conaffinity="3" ${metal}/>`);
  out.push(`<geom name="claw_ring" priority="1" type="cylinder" size="${v((HEAD.radius + 0.003) * s, 0.005 * s)}" mass="${f(headMass * 0.08)}" ${gold} contype="3" conaffinity="3" ${metal}/>`);
  out.push(`<geom name="claw_cap" priority="1" type="cylinder" pos="${v(0, 0, (HEAD.halfHeight + 0.0035) * s)}" size="${v(0.014 * s, 0.0035 * s)}" mass="${f(headMass * 0.04)}" ${black} contype="3" conaffinity="3"/>`);
  out.push(`<geom name="claw_rod" priority="1" type="cylinder" pos="${v(0, 0, (HEAD.hubZ - HEAD.halfHeight) * 0.5 * s)}" size="${v(0.005 * s, (-HEAD.hubZ - HEAD.halfHeight) * 0.5 * s)}" mass="${f(headMass * 0.04)}" rgba="0.8 0.8 0.84 1" ${metal}/>`);
  out.push(`<geom name="claw_hub" priority="1" type="box" pos="${v(0, 0, HEAD.hubZ * s)}" size="${v(0.016 * s, 0.016 * s, 0.007 * s)}" mass="${f(headMass * 0.12)}" ${gold} ${metal}/>`);
  out.push(`<site name="rope_bot" pos="${v(0, 0, HEAD.ropeOffset * s)}" size="0.003"/>`);

  for (let i = 0; i < ARM_COUNT; i++) {
    const g = armGeometry(s, t.arms[i].spreadCm);
    const phi = ARM_ANGLES[i];
    const pts = g.points;
    const lengths = pts.slice(1).map((p, k) => Math.hypot(p[0] - pts[k][0], p[1] - pts[k][1]));
    const total = lengths.reduce((x, y) => x + y, 0);
    const [tx, tz] = g.tip;
    out.push(`<body name="arm${i}" pos="${v(g.hingeR * Math.cos(phi), g.hingeR * Math.sin(phi), g.hingeZ)}" euler="0 0 ${f(phi)}">`);
    out.push(
      `<joint name="arm${i}_hinge" type="hinge" axis="0 -1 0" range="${v(-0.02, g.openAngle)}" limited="true" ` +
        `stiffness="${f(ARM_SPRING)}" springref="${f(g.openAngle + ARM_SPRING_PRELOAD)}" damping="0.0015" armature="0.00005"/>`,
    );
    // The rod as a chain of capsules along the curve; the last one wears the rubber sleeve.
    const last = pts.length - 2;
    for (let k = 0; k <= last; k++) {
      const [x0, z0] = pts[k];
      const [x1, z1] = pts[k + 1];
      const mass = f((armMass * lengths[k]) / total);
      if (k < last) {
        out.push(`<geom name="arm${i}_seg${k}" priority="1" type="capsule" fromto="${v(x0, 0, z0, x1, 0, z1)}" size="${f(0.0042 * s)}" mass="${mass}" ${black} ${metal}/>`);
      } else {
        out.push(
          `<geom name="arm${i}_sleeve" priority="1" type="capsule" fromto="${v(x0, 0, z0, x1, 0, z1)}" size="${f(0.0062 * s)}" mass="${mass}" ` +
            `rgba="0.15 0.15 0.15 1" condim="6" friction="${v(...sleeve.friction)}" solref="${v(sleeve.solrefTime, 1)}"/>`,
        );
      }
    }
    out.push(`<site name="arm${i}_tip" pos="${v(tx, 0, tz)}" size="0.002"/>`);
    out.push(`</body>`);
  }
  out.push(`</body>`);
  return out.join('\n');
}

/**
 * Height (gantry frame) where the claw cap meets the anti-swing plate, just as it reaches the
 * top. The plate hangs directly under the carriage, nothing in between.
 */
export const ANTISWING_CONTACT_Z = CABINET.pulleyZ - CABINET.ropeTop + 0.002;
const ANTISWING_SEGMENTS = 8;
const ANTISWING_LENGTH = 0.1;
const ANTISWING_HALF_WIDTH = 0.032;
/** Where along the plate (fraction from its centre) the cable passes and the claw hits. */
const ANTISWING_HIT = -0.35;

/** Throw direction as a unit vector: 0° = front (towards the player), 90° = right. */
export function antiSwingDirection(directionDeg: number): [number, number] {
  const a = (directionDeg * Math.PI) / 180;
  return [Math.sin(a), -Math.cos(a)];
}

/**
 * Profile of the anti-swing plate in its own (u, z) plane, u along the throw direction:
 * a dome (concave side facing the claw) bent by `concavityDeg` end to end, shifted so the
 * point above the cable sits at ANTISWING_CONTACT_Z. There its underside slopes up
 * towards +u, so a claw rising into it is pushed towards +u, the throw direction.
 */
export function antiSwingProfile(concavityDeg: number): Array<{ u: number; z: number; angle: number; len: number }> {
  const theta = (concavityDeg * Math.PI) / 180;
  const n = ANTISWING_SEGMENTS;
  const len = ANTISWING_LENGTH / n;
  const pts: Array<[number, number]> = [[0, 0]];
  const angles: number[] = [];
  for (let k = 0; k < n; k++) {
    // Tangent angle runs from +θ/2 to −θ/2 across the plate (rises, crests, falls).
    const ang = theta * (0.5 - (k + 0.5) / n);
    angles.push(ang);
    const [pu, pz] = pts[pts.length - 1];
    pts.push([pu + Math.cos(ang) * len, pz + Math.sin(ang) * len]);
  }
  // Point on the plate at the hit fraction; shift it onto the cable axis at the contact height.
  const hitIndex = ((ANTISWING_HIT + 0.5) * n);
  const k0 = Math.floor(hitIndex);
  const fr = hitIndex - k0;
  const hu = pts[k0][0] + (pts[k0 + 1][0] - pts[k0][0]) * fr;
  const hz = pts[k0][1] + (pts[k0 + 1][1] - pts[k0][1]) * fr;
  return angles.map((angle, k) => ({
    u: (pts[k][0] + pts[k + 1][0]) / 2 - hu,
    z: (pts[k][1] + pts[k + 1][1]) / 2 - hz + ANTISWING_CONTACT_Z,
    angle,
    len,
  }));
}

function antiSwingXml(t: ClawTuning): string {
  const [dx, dy] = antiSwingDirection(t.antiSwing.directionDeg);
  const yaw = Math.atan2(dy, dx);
  const thick = 0.0015;
  const geoms = antiSwingProfile(t.antiSwing.concavityDeg).map(
    (seg, k) =>
      // The box's long axis follows the profile; its top face is the plate's underside + thickness.
      `<geom name="antiswing_${k}" priority="1" type="box" pos="${v(seg.u, 0, seg.z + thick)}" euler="${v(0, -seg.angle, 0)}" ` +
      `size="${v(seg.len / 2 + 0.0005, ANTISWING_HALF_WIDTH, thick)}" mass="0.01" rgba="0.85 0.86 0.9 1" contype="3" conaffinity="3" friction="0.3 0.003 0.0001"/>`,
  );
  return `<frame euler="${v(0, 0, yaw)}">\n  ${geoms.join('\n  ')}\n  </frame>`;
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

function cabinetXml(guardH: number, bedH: number): string {
  const { halfW: W, halfD: D, wallH, hole, guardT } = CABINET;
  const T = 0.02;
  const box = (name: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, extra = '') =>
    `<geom name="${name}" type="box" pos="${v((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)}" size="${v((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2)}" ${extra}/>`;
  const floor = `rgba="0.98 0.6 0.78 1" friction="0.6 0.005 0.0002"`;
  const glass = `rgba="0.8 0.9 1 0.12" friction="0.2 0.002 0.0001"`;
  const acrylic = `rgba="0.85 0.95 1 0.3" friction="0.25 0.002 0.0001"`;
  const chute = `rgba="0.25 0.25 0.3 1" friction="0.3 0.003 0.0001"`;
  return [
    // Prize bed (plush fabric) with the chute cut out of the front-left corner; a raised bed
    // is a solid block from the lowest position up to its top.
    box('floor_main', hole.x1, W, -D, D, -T, bedH, floor),
    box('floor_back', -W, hole.x1, hole.y1, D, -T, bedH, floor),
    // Glass walls.
    box('glass_left', -W - 0.01, -W, -D, D, -0.3, wallH, glass),
    box('glass_right', W, W + 0.01, -D, D, -0.3, wallH, glass),
    box('glass_back', -W, W, D, D + 0.01, -0.3, wallH, glass),
    box('glass_front', -W, W, -D - 0.01, -D, 0, wallH, glass),
    // Acrylic guard around the chute (防護擋板); the operator sets its height, 0 removes it.
    ...(guardH > 0.001
      ? [
          box('guard_side', hole.x1, hole.x1 + guardT, hole.y0, hole.y1 + guardT, bedH, bedH + guardH, acrylic),
          box('guard_back', hole.x0, hole.x1 + guardT, hole.y1, hole.y1 + guardT, bedH, bedH + guardH, acrylic),
        ]
      : []),
    // Chute shaft and the sloped slide to the pickup door.
    // Above the lowest bed the raised floor block and the front glass already wall the shaft in,
    // so these stay below the bed (a raised dark wall would show through the front glass).
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
  /** Prize-bed height above its lowest position in metres (default 0). */
  bedH?: number;
  timestep?: number;
}

export function buildMjcf(opts: MjcfOptions): string {
  const { claw, prizes } = opts;
  const { travel, gantryZ } = CABINET;
  return `<mujoco model="feiluoli-standard">
<compiler angle="radian" autolimits="true"/>
<option timestep="${f(opts.timestep ?? 0.002)}" integrator="implicitfast" cone="elliptic" impratio="4" iterations="60" ls_iterations="20" gravity="0 0 -9.81"/>
<size memory="64M"/>
<default>
  <geom contype="1" conaffinity="1" condim="4" solref="0.004 1" solimp="0.9 0.97 0.001"/>
</default>
<worldbody>
${cabinetXml(opts.guardH ?? CABINET.guardH, opts.bedH ?? 0)}
<body name="gantry" pos="${v(0, 0, gantryZ)}">
  <joint name="gantry_x" type="slide" axis="1 0 0" range="${v(travel.x0, travel.x1)}" damping="4" armature="0.05"/>
  <joint name="gantry_y" type="slide" axis="0 1 0" range="${v(travel.y0, travel.y1)}" damping="4" armature="0.05"/>
  <geom name="gantry_carriage" type="box" pos="0 0 0.03" size="0.06 0.05 0.03" mass="2.2" rgba="0.95 0.8 0.15 1" contype="0" conaffinity="0"/>
  <site name="pulley" pos="${v(0, 0, CABINET.pulleyZ)}" size="0.004"/>
  <!-- 防甩片: bent plate under the gantry the claw hits on the way up. -->
  ${antiSwingXml(claw)}
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
