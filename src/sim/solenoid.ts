/**
 * Claw solenoid (電磁閥) model.
 *
 * The Feiluoli board drives the claw coil with a PWM'd DC voltage (0–48 V). The coil
 * current I = V / R saturates the iron above ~I_SAT, and the plunger pull grows with I²
 * and as the air gap closes (the claw grips harder once nearly shut). The pull is split
 * over the three arms through the linkage as a closing torque at each hinge.
 *
 * Coil inductance makes the current — and therefore the grip — follow voltage changes
 * with an L/R time constant, so a strong→medium switch "fades" over tens of ms.
 */

export const COIL_R = 16; // Ω
export const COIL_TAU = 0.03; // s (L/R)
export const I_SAT = 2.6; // A, iron saturation knee
/** Per-arm closing torque at 48 V with the claw fully closed (N·m). */
export const TORQUE_48V = 0.3;

const I48 = Math.min(48 / COIL_R, I_SAT * 1.15);

/** Effective (soft-saturated) magnetising current. */
function effectiveCurrent(i: number): number {
  const k = I_SAT * 1.15;
  return k * Math.tanh(i / k);
}

/**
 * Closing torque per arm for a coil current, and a normalised closure c ∈ [0,1]
 * (0 = fully open, 1 = fully closed) — the pull rises as the gap shrinks.
 */
export function solenoidTorque(current: number, closure: number): number {
  const ie = effectiveCurrent(Math.max(0, current));
  const ref = effectiveCurrent(I48);
  const gapGain = 0.55 + 0.45 * Math.max(0, Math.min(1, closure));
  return TORQUE_48V * (ie / ref) ** 2 * gapGain;
}

/** Torque at a given steady voltage (for UI read-outs and tests). */
export function torqueAtVoltage(volts: number, closure = 1): number {
  return solenoidTorque(volts / COIL_R, closure);
}

export class Solenoid {
  current = 0;
  volts = 0;

  setVoltage(v: number): void {
    this.volts = Math.max(0, Math.min(48, v));
  }

  /** Integrates the coil current (exact first-order step). */
  step(dt: number): void {
    const target = this.volts / COIL_R;
    this.current = target + (this.current - target) * Math.exp(-dt / COIL_TAU);
  }

  torque(closure: number): number {
    return solenoidTorque(this.current, closure);
  }
}
