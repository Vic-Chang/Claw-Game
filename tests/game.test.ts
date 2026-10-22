import { expect, test } from 'vitest';
import { Board } from '../src/machine/controller';
import { defaultSettings } from '../src/machine/settings';
import { defaultClawTuning } from '../src/sim/clawConfig';
import { ClawSimulation } from '../src/sim/simulation';

/**
 * End-to-end: a player inserts a coin, steers with the joystick, waits for the swing to
 * settle, presses 取物, and the board + physics deliver the prize down the chute.
 */
async function playOnce(aim: [number, number], overrides: Record<string, number>) {
  const sim = await ClawSimulation.create(defaultClawTuning(), [{ kind: 'plushSmall', pos: [-0.04, -0.12, 0.06], yaw: 0.3, color: '#fff' }]);
  sim.reset(1.0);
  const board = new Board({ ...defaultSettings(), ...overrides }, () => 0.5);
  sim.events.onPrizeDrop = () => board.prizeDropped();
  const b = sim.ids.prizeBodies[0] * 3;
  const target: [number, number] = [sim.data.xpos[b] + aim[0], sim.data.xpos[b + 1] + aim[1]];
  const step = (seconds: number) => sim.step(seconds, (dt) => board.update(dt, sim));

  board.insertCoin();
  // Joystick is on/off per axis, like the real 8-way stick.
  for (let t = 0; t < 10; t += 0.01) {
    const [gx, gy] = sim.gantryPos();
    const jx = Math.abs(target[0] - gx) > 0.004 ? Math.sign(target[0] - gx) : 0;
    const jy = Math.abs(target[1] - gy) > 0.004 ? Math.sign(target[1] - gy) : 0;
    board.setJoystick(jx, jy);
    step(0.01);
    if (!jx && !jy) break;
  }
  board.setJoystick(0, 0);
  step(2.0);
  board.pressGrab();
  for (let t = 0; t < 30 && !(board.state === 'idle' && t > 1); t += 0.05) step(0.05);
  step(2.0);
  const result = { wins: board.accounts.wins, remaining: sim.remainingPrizes(), history: [...board.accounts.history] };
  sim.dispose();
  return result;
}

test('a guaranteed (保夾) game can win a prize all the way down the chute', async () => {
  // A3 = 10: the very first paid game is a 保夾 game running on B5 = 48 V.
  const settings = { A3: 10, B5: 48, A2: 15 };
  let won = null;
  for (const aim of [
    [0.02, 0],
    [0, 0.02],
    [-0.02, 0],
    [0, -0.02],
    [0.015, 0.015],
  ] as Array<[number, number]>) {
    const r = await playOnce(aim, settings);
    if (r.wins > 0) {
      won = r;
      break;
    }
  }
  expect(won).not.toBeNull();
  expect(won!.remaining).toBe(0);
  expect(won!.history[0]).toBe(10);
}, 120000);

test('with B3 弱電壓 at 0 V the prize is always dropped before the chute', async () => {
  const settings = { B1: 48, B2: 48, B3: 0, A3: 1990 };
  for (const aim of [
    [0.02, 0],
    [0, 0.02],
  ] as Array<[number, number]>) {
    const r = await playOnce(aim, settings);
    expect(r.wins).toBe(0);
  }
}, 120000);
