import { CABINET, overHole } from './cabinet';
import { type ClawTuning, cloneClawTuning, sleeveSpec } from './clawConfig';
import { ARM_COUNT, armGeometry, buildMjcf } from './mjcf';
import { getMujoco, type Mujoco } from './mujoco';
import { PRIZE_KINDS, type PrizePlacement } from './prizes';
import { Solenoid } from './solenoid';
import { SIZE_SCALE } from './clawConfig';

type MjModel = InstanceType<Mujoco['MjModel']>;
type MjData = InstanceType<Mujoco['MjData']>;

export interface PrizeState {
  index: number;
  kind: PrizePlacement['kind'];
  color: string;
  won: boolean;
}

export interface SimEvents {
  /** A prize broke the chute electric eye (落物電眼). */
  onPrizeDrop?: (index: number) => void;
  /** Impulsive contact of the claw/carriage with glass etc., for sound. */
  onKnock?: (strength: number) => void;
}

/** Ids looked up once per compiled model. */
interface Ids {
  gantryX: number;
  gantryY: number;
  gantryXq: number;
  gantryYq: number;
  gantryXv: number;
  gantryYv: number;
  motorX: number;
  motorY: number;
  solenoid: number[];
  armQ: number[];
  armDof: number[];
  headBody: number;
  headQ: number;
  headDof: number;
  cable: number;
  sleeveGeoms: number[];
  prizeBodies: number[];
  prizeQ: number[];
  prizeDof: number[];
  /** All bodies belonging to each prize (for teleporting plush with its limbs). */
  prizeTreeQ: Array<Array<[number, number, number, number]>>;
}

/**
 * The physical machine: MuJoCo model + the electro-mechanical actuators the control
 * board talks to (gantry motors, cable winch, claw solenoid) + the chute electric eye.
 */
export class ClawSimulation {
  readonly mj: Mujoco;
  model!: MjModel;
  data!: MjData;
  ids!: Ids;
  claw: ClawTuning;
  prizes: PrizePlacement[];
  /** Chute guard (出貨口擋板) height in metres. */
  guardH: number = CABINET.guardH;
  prizeState: PrizeState[] = [];
  readonly solenoid = new Solenoid();
  readonly timestep = 0.002;
  events: SimEvents = {};

  /** Winch: current paid-out cable length limit and its velocity (+ = paying out). */
  private ropeLen: number = CABINET.ropeTop;
  private ropeVel = 0;
  private gantryTarget: [number, number] = [0, 0];
  private wonAt = new Map<number, number>();
  private siteIds = new Map<string, number>();
  private knockCooldown = 0;
  private prevHeadVel: [number, number, number] = [0, 0, 0];
  time = 0;

  private constructor(mj: Mujoco, claw: ClawTuning, prizes: PrizePlacement[], guardH: number) {
    this.mj = mj;
    this.guardH = guardH;
    this.claw = cloneClawTuning(claw);
    this.prizes = prizes.map((p) => ({ ...p }));
    this.compile();
  }

  static async create(claw: ClawTuning, prizes: PrizePlacement[], guardH: number = CABINET.guardH): Promise<ClawSimulation> {
    return new ClawSimulation(await getMujoco(), claw, prizes, guardH);
  }

  private name2id(type: number, name: string): number {
    for (let i = 0; i < this.countOf(type); i++) {
      if (this.mj.mj_id2name(this.model, type, i) === name) return i;
    }
    throw new Error(`MuJoCo object not found: ${name}`);
  }

  private countOf(type: number): number {
    const o = this.mj.mjtObj;
    const m = this.model;
    if (type === o.mjOBJ_BODY.value) return m.nbody;
    if (type === o.mjOBJ_JOINT.value) return m.njnt;
    if (type === o.mjOBJ_GEOM.value) return m.ngeom;
    if (type === o.mjOBJ_ACTUATOR.value) return m.nu;
    if (type === o.mjOBJ_TENDON.value) return m.ntendon;
    if (type === o.mjOBJ_SITE.value) return m.nsite;
    return 0;
  }

  geomName(i: number): string {
    return this.mj.mj_id2name(this.model, this.mj.mjtObj.mjOBJ_GEOM.value, i);
  }

  private compile(): void {
    const xml = buildMjcf({ claw: this.claw, prizes: this.prizes, guardH: this.guardH, timestep: this.timestep });
    const mj = this.mj;
    this.model = mj.MjModel.from_xml_string(xml);
    this.data = new mj.MjData(this.model);
    const o = mj.mjtObj;
    const m = this.model;
    const body = (n: string) => this.name2id(o.mjOBJ_BODY.value, n);
    const jnt = (n: string) => this.name2id(o.mjOBJ_JOINT.value, n);
    const act = (n: string) => this.name2id(o.mjOBJ_ACTUATOR.value, n);
    const gx = jnt('gantry_x');
    const gy = jnt('gantry_y');
    const armJ = [0, 1, 2].map((i) => jnt(`arm${i}_hinge`));
    const headJ = jnt('claw_free');
    const prizeBodies = this.prizes.map((_, i) => body(`prize${i}`));
    const prizeJ = this.prizes.map((_, i) => jnt(`prize${i}_free`));
    this.ids = {
      gantryX: gx,
      gantryY: gy,
      gantryXq: m.jnt_qposadr[gx],
      gantryYq: m.jnt_qposadr[gy],
      gantryXv: m.jnt_dofadr[gx],
      gantryYv: m.jnt_dofadr[gy],
      motorX: act('motor_x'),
      motorY: act('motor_y'),
      solenoid: [0, 1, 2].map((i) => act(`solenoid${i}`)),
      armQ: armJ.map((j) => m.jnt_qposadr[j]),
      armDof: armJ.map((j) => m.jnt_dofadr[j]),
      headBody: body('claw_head'),
      headQ: m.jnt_qposadr[headJ],
      headDof: m.jnt_dofadr[headJ],
      cable: this.name2id(o.mjOBJ_TENDON.value, 'cable'),
      sleeveGeoms: [0, 1, 2].map((i) => this.name2id(o.mjOBJ_GEOM.value, `arm${i}_sleeve`)),
      prizeBodies,
      prizeQ: prizeJ.map((j) => m.jnt_qposadr[j]),
      prizeDof: prizeJ.map((j) => m.jnt_dofadr[j]),
      prizeTreeQ: [],
    };
    this.siteIds.clear();
    this.prizeState = this.prizes.map((p, i) => ({ index: i, kind: p.kind, color: p.color, won: this.prizeState[i]?.won ?? false }));
    this.applySleeve();
  }

  /** Gantry carriage position (x, y). */
  gantryPos(): [number, number] {
    const q = this.data.qpos;
    return [q[this.ids.gantryXq], q[this.ids.gantryYq]];
  }

  setGantryPos(x: number, y: number): void {
    const q = this.data.qpos;
    q[this.ids.gantryXq] = x;
    q[this.ids.gantryYq] = y;
  }

  /** Places the claw head straight under the carriage at the current cable length. */
  private hangClawUnderGantry(): void {
    const [x, y] = this.gantryPos();
    const s = SIZE_SCALE[this.claw.size];
    const q = this.data.qpos;
    const a = this.ids.headQ;
    q[a] = x;
    q[a + 1] = y;
    q[a + 2] = CABINET.gantryZ - 0.02 - this.ropeLen - 0.044 * s;
    q[a + 3] = 1;
    q[a + 4] = 0;
    q[a + 5] = 0;
    q[a + 6] = 0;
    const qv = this.data.qvel;
    for (let k = 0; k < 6; k++) qv[this.ids.headDof + k] = 0;
    // Arms start open (spring-loaded open when the coil is off).
    const sc = SIZE_SCALE[this.claw.size];
    for (let i = 0; i < ARM_COUNT; i++) {
      q[this.ids.armQ[i]] = armGeometry(sc, this.claw.arms[i].spreadCm).openAngle;
      qv[this.ids.armDof[i]] = 0;
    }
  }

  /** Resets the machine to power-on: gantry home, claw at the top, prizes settled. */
  reset(settleSeconds = 1.5): void {
    this.mj.mj_resetData(this.model, this.data);
    this.ropeLen = CABINET.ropeTop;
    this.ropeVel = 0;
    this.setGantryPos(CABINET.home.x, CABINET.home.y);
    this.hangClawUnderGantry();
    this.model.tendon_range[this.ids.cable * 2 + 1] = this.ropeLen;
    this.mj.mj_forward(this.model, this.data);
    this.settle(settleSeconds);
  }

  /** Lets everything come to rest without advancing game time. */
  settle(seconds: number): void {
    const n = Math.round(seconds / this.timestep);
    for (let i = 0; i < n; i++) this.stepOnce(false);
  }

  /** Gantry motor velocity targets in m/s (the board's motor drive). */
  setGantryVelocity(vx: number, vy: number): void {
    this.gantryTarget = [vx, vy];
  }

  /** Winch velocity in m/s, + pays cable out (claw goes down). */
  setWinchVelocity(v: number): void {
    this.ropeVel = v;
  }

  setClawVoltage(volts: number): void {
    this.solenoid.setVoltage(volts);
  }

  /** Paid-out cable length (the winch limit). */
  get cableLimit(): number {
    return this.ropeLen;
  }

  /** Actual taut length between pulley and claw head. */
  get cableLength(): number {
    return this.data.ten_length[this.ids.cable];
  }

  /** How much cable is slack — the claw is resting on something. */
  get cableSlack(): number {
    return this.ropeLen - this.cableLength;
  }

  /** Claw head world position. */
  headPos(): [number, number, number] {
    const b = this.ids.headBody * 3;
    const x = this.data.xpos;
    return [x[b], x[b + 1], x[b + 2]];
  }

  /** Head linear velocity (world frame), from the free joint dofs. */
  headVel(): [number, number, number] {
    const qv = this.data.qvel;
    const a = this.ids.headDof;
    return [qv[a], qv[a + 1], qv[a + 2]];
  }

  /** Normalised closure of each arm: 0 = fully open, 1 = closed. */
  armClosure(): number[] {
    const out: number[] = [];
    const s = SIZE_SCALE[this.claw.size];
    for (let i = 0; i < ARM_COUNT; i++) {
      const open = armGeometry(s, this.claw.arms[i].spreadCm).openAngle;
      out.push(1 - Math.max(0, Math.min(1, this.data.qpos[this.ids.armQ[i]] / open)));
    }
    return out;
  }

  private applySleeve(): void {
    const spec = sleeveSpec(this.claw);
    const fr = this.model.geom_friction;
    const sr = this.model.geom_solref;
    for (const g of this.ids.sleeveGeoms) {
      fr[g * 3] = spec.friction[0];
      fr[g * 3 + 1] = spec.friction[1];
      fr[g * 3 + 2] = spec.friction[2];
      sr[g * 2] = spec.solrefTime;
    }
  }

  /**
   * Applies new mechanical claw tuning. Friction-only changes are applied live; geometry
   * changes rebuild the model, keeping every prize and the gantry where they are.
   */
  setClawTuning(t: ClawTuning): void {
    const geomChanged =
      t.size !== this.claw.size ||
      t.arms.some(
        (a, i) =>
          a.spreadCm !== this.claw.arms[i].spreadCm ||
          a.finConcavityDeg !== this.claw.arms[i].finConcavityDeg ||
          a.finDirectionDeg !== this.claw.arms[i].finDirectionDeg,
      );
    this.claw = cloneClawTuning(t);
    if (!geomChanged) {
      this.applySleeve();
      return;
    }
    this.rebuild();
  }

  /** Changes the chute guard height (cm on the set-up page, metres here); prizes stay put. */
  setGuardHeight(h: number): void {
    const [lo, hi] = CABINET.guardRange;
    const clamped = Math.max(lo, Math.min(hi, h));
    if (Math.abs(clamped - this.guardH) < 1e-6) return;
    this.guardH = clamped;
    this.rebuild();
  }

  /** Replaces the prize layout (machine set-up page) and restarts physics. */
  setPrizes(prizes: PrizePlacement[]): void {
    this.prizes = prizes.map((p) => ({ ...p }));
    this.prizeState = [];
    this.wonAt.clear();
    this.data.delete();
    this.model.delete();
    this.compile();
    this.reset();
  }

  private rebuild(): void {
    // Snapshot prize poses so the rebuilt model starts exactly where we were.
    const q = this.data.qpos;
    this.prizes = this.prizes.map((p, i) => {
      const a = this.ids.prizeQ[i];
      return { ...p, pos: [q[a], q[a + 1], q[a + 2]], quat: [q[a + 3], q[a + 4], q[a + 5], q[a + 6]] };
    });
    const [gx, gy] = this.gantryPos();
    this.data.delete();
    this.model.delete();
    this.compile();
    this.setGantryPos(gx, gy);
    this.hangClawUnderGantry();
    this.model.tendon_range[this.ids.cable * 2 + 1] = this.ropeLen;
    this.mj.mj_forward(this.model, this.data);
    this.settle(0.1);
  }

  /**
   * Advances physics by `seconds` in fixed sub-steps. `beforeEach` runs before every
   * sub-step — the control board reads sensors and drives motors at physics rate.
   */
  step(seconds: number, beforeEach?: (dt: number) => void): void {
    const n = Math.max(1, Math.round(seconds / this.timestep));
    for (let i = 0; i < n; i++) {
      beforeEach?.(this.timestep);
      this.stepOnce(true);
    }
  }

  /** Site world position by name (cable end points etc.). */
  sitePos(name: string): [number, number, number] {
    const id = this.siteIds.get(name) ?? this.name2id(this.mj.mjtObj.mjOBJ_SITE.value, name);
    this.siteIds.set(name, id);
    const p = this.data.site_xpos;
    return [p[id * 3], p[id * 3 + 1], p[id * 3 + 2]];
  }

  private stepOnce(advanceTime: boolean): void {
    const dt = this.timestep;
    const m = this.model;
    const d = this.data;

    // Winch: pay out / reel in the cable limit.
    if (this.ropeVel !== 0) {
      this.ropeLen = Math.max(CABINET.ropeMin, Math.min(CABINET.ropeMax, this.ropeLen + this.ropeVel * dt));
      // When reeling in a slack cable, take the slack up first (the drum just winds it).
      if (this.ropeVel < 0 && this.ropeLen > this.cableLength + 0.002) {
        this.ropeLen = Math.max(this.cableLength + 0.002, this.ropeLen + this.ropeVel * dt * 4);
      }
      m.tendon_range[this.ids.cable * 2 + 1] = this.ropeLen;
    }

    // Gantry motor drive.
    d.ctrl[this.ids.motorX] = advanceTime ? this.gantryTarget[0] : 0;
    d.ctrl[this.ids.motorY] = advanceTime ? this.gantryTarget[1] : 0;

    // Claw solenoid.
    this.solenoid.step(dt);
    const closure = this.armClosure();
    for (let i = 0; i < ARM_COUNT; i++) {
      d.ctrl[this.ids.solenoid[i]] = -this.solenoid.torque(closure[i]);
    }

    this.mj.mj_step(m, d);
    if (!advanceTime) return;
    this.time += dt;
    this.checkElectricEye();
    this.detectKnock(dt);
  }

  private checkElectricEye(): void {
    const x = this.data.xpos;
    for (let i = 0; i < this.prizes.length; i++) {
      const st = this.prizeState[i];
      const b = this.ids.prizeBodies[i] * 3;
      if (!st.won && x[b + 2] < -0.06 && x[b + 2] > -0.4 && overHole(x[b], x[b + 1])) {
        st.won = true;
        this.wonAt.set(i, this.time);
        this.events.onPrizeDrop?.(i);
      }
      const t = this.wonAt.get(i);
      if (t !== undefined && this.time - t > 1.2) {
        this.wonAt.delete(i);
        this.moveToStorage(i);
      }
    }
  }

  /** Won prizes are taken out of the cabinet (picked up from the door). */
  private moveToStorage(i: number): void {
    const q = this.data.qpos;
    const qv = this.data.qvel;
    const m = this.model;
    const root = this.ids.prizeBodies[i];
    const a = this.ids.prizeQ[i];
    const dx = 3 + i * 0.4 - q[a];
    const dy = 3 - q[a + 1];
    const dz = -2.85 - q[a + 2];
    q[a] += dx;
    q[a + 1] += dy;
    q[a + 2] += dz;
    for (let k = 0; k < 6; k++) qv[this.ids.prizeDof[i] + k] = 0;
    // Child limbs use ball joints relative to the root, so they follow automatically; just stop them.
    for (let b = 0; b < m.nbody; b++) {
      if (m.body_rootid[b] === root && b !== root) {
        const j = m.body_jntadr[b];
        if (j >= 0) for (let k = 0; k < 3; k++) qv[m.jnt_dofadr[j] + k] = 0;
      }
    }
    this.mj.mj_forward(m, this.data);
  }

  private detectKnock(dt: number): void {
    this.knockCooldown = Math.max(0, this.knockCooldown - dt);
    const v = this.headVel();
    const dv = Math.hypot(v[0] - this.prevHeadVel[0], v[1] - this.prevHeadVel[1], v[2] - this.prevHeadVel[2]);
    this.prevHeadVel = v;
    // A sudden velocity change of the hanging claw = it hit glass, the tube or a prize.
    if (dv > 0.25 && this.knockCooldown === 0) {
      this.knockCooldown = 0.08;
      this.events.onKnock?.(Math.min(1, dv / 1.5));
    }
  }

  /** Prizes still inside the play field. */
  remainingPrizes(): number {
    return this.prizeState.filter((p) => !p.won).length;
  }

  /** Is a prize (not yet won) being held clear of the bed by the claw? */
  liftedPrize(): number | null {
    const x = this.data.xpos;
    for (let i = 0; i < this.prizes.length; i++) {
      if (this.prizeState[i].won) continue;
      const b = this.ids.prizeBodies[i] * 3;
      const h = PRIZE_KINDS[this.prizes[i].kind].half;
      if (x[b + 2] > Math.max(...h) + 0.08) return i;
    }
    return null;
  }

  dispose(): void {
    this.data.delete();
    this.model.delete();
  }
}
