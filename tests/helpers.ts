import { CABINET } from '../src/sim/cabinet';
import type { ClawSimulation } from '../src/sim/simulation';

/** Drives the gantry to (x, y) with a simple proportional controller, then lets it settle. */
export function moveGantry(sim: ClawSimulation, x: number, y: number, maxV = 0.25): void {
  for (let t = 0; t < 6; t += 0.01) {
    const [gx, gy] = sim.gantryPos();
    const ex = x - gx;
    const ey = y - gy;
    if (Math.hypot(ex, ey) < 0.002) break;
    const k = 4;
    sim.setGantryVelocity(Math.max(-maxV, Math.min(maxV, ex * k)), Math.max(-maxV, Math.min(maxV, ey * k)));
    sim.step(0.01);
  }
  sim.setGantryVelocity(0, 0);
  sim.step(0.8);
}

/** Lowers the claw until the cable goes slack (or max time), like a real drop. */
export function dropClaw(sim: ClawSimulation, speed = 0.3, maxTime = 3): void {
  sim.setWinchVelocity(speed);
  for (let t = 0; t < maxTime; t += 0.01) {
    sim.step(0.01);
    if (sim.cableSlack > 0.008) break;
  }
  sim.setWinchVelocity(0);
}

export function raiseClaw(sim: ClawSimulation, speed = 0.3, onStep?: () => void): void {
  sim.setWinchVelocity(-speed);
  for (let t = 0; t < 4; t += 0.01) {
    sim.step(0.01);
    onStep?.();
    if (sim.cableLimit <= CABINET.ropeTop + 1e-4) break;
  }
  sim.setWinchVelocity(0);
}

/** Highest z among the given prize's bodies. */
export function prizeZ(sim: ClawSimulation, i: number): number {
  return sim.data.xpos[sim.ids.prizeBodies[i] * 3 + 2];
}
