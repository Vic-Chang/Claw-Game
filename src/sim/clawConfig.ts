/**
 * Physical (mechanical) claw adjustments — the things an operator changes with
 * pliers and spare parts, not through the Feiluoli control board.
 */

export type ClawSize = 'small' | 'medium' | 'large';
export type SleeveMaterial = 'metal' | 'plastic' | 'rubber' | 'silicone' | 'custom';

export interface ArmTuning {
  /** Tip spread when fully open, measured tip-to-axis × 2 (cm). */
  spreadCm: number;
}

/**
 * Anti-swing plate (防甩片): a bent metal sheet under the gantry, above the whole claw.
 * The claw hits it when it is reeled back up; the bend kicks the claw sideways and
 * flings what it holds.
 */
export interface AntiSwingTuning {
  /** Bend of the plate, degrees. 0 = flat (only a vertical jolt); more = throws further. */
  concavityDeg: number;
  /** Direction the prize gets thrown, degrees clockwise seen from above; 0 = towards the player (front). */
  directionDeg: number;
}

export interface ClawTuning {
  size: ClawSize;
  sleeve: SleeveMaterial;
  /** Sliding friction used when sleeve === 'custom'. */
  customFriction: number;
  /** Per-arm tuning, three arms at 0°, 120°, 240° (arm 0 points to the back of the cabinet). */
  arms: [ArmTuning, ArmTuning, ArmTuning];
  antiSwing: AntiSwingTuning;
}

export interface SleeveSpec {
  label: string;
  /** MuJoCo friction triple: sliding, torsional, rolling. */
  friction: [number, number, number];
  /** Contact softness (solref timeconst) — softer sleeves deform more. */
  solrefTime: number;
}

export const SLEEVES: Record<Exclude<SleeveMaterial, 'custom'>, SleeveSpec> = {
  metal: { label: '無爪套（金屬）', friction: [0.3, 0.003, 0.0001], solrefTime: 0.004 },
  plastic: { label: '塑膠套', friction: [0.5, 0.005, 0.0001], solrefTime: 0.006 },
  rubber: { label: '橡膠套', friction: [0.9, 0.01, 0.0002], solrefTime: 0.01 },
  silicone: { label: '矽膠防滑套', friction: [1.1, 0.015, 0.0003], solrefTime: 0.014 },
};

export function sleeveSpec(t: Pick<ClawTuning, 'sleeve' | 'customFriction'>): SleeveSpec {
  if (t.sleeve === 'custom') {
    const mu = Math.max(0.05, Math.min(2, t.customFriction));
    return { label: `自訂 μ=${mu.toFixed(2)}`, friction: [mu, mu * 0.012, 0.0002], solrefTime: 0.01 };
  }
  return SLEEVES[t.sleeve];
}

export const SIZE_SCALE: Record<ClawSize, number> = { small: 0.82, medium: 1, large: 1.22 };
export const SIZE_LABEL: Record<ClawSize, string> = { small: '小爪', medium: '中爪（標準 JS 爪）', large: '大爪' };

/** Allowed spread range for a given claw size (cm). */
export function spreadRange(size: ClawSize): [number, number] {
  const s = SIZE_SCALE[size];
  return [Math.round(7 * s * 10) / 10, Math.round(16 * s * 10) / 10];
}

export function defaultClawTuning(): ClawTuning {
  const arm = (): ArmTuning => ({ spreadCm: 12 });
  return { size: 'medium', sleeve: 'rubber', customFriction: 0.8, arms: [arm(), arm(), arm()], antiSwing: defaultAntiSwing() };
}

export function defaultAntiSwing(): AntiSwingTuning {
  return { concavityDeg: 15, directionDeg: 0 };
}

export function cloneClawTuning(t: ClawTuning): ClawTuning {
  return { ...t, arms: t.arms.map((a) => ({ ...a })) as ClawTuning['arms'], antiSwing: { ...t.antiSwing } };
}
