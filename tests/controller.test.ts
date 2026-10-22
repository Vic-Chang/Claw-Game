import { describe, expect, test } from 'vitest';
import { B4_STEP, Board, type MachineIO } from '../src/machine/controller';
import { defaultSettings, type Settings } from '../src/machine/settings';
import { CABINET } from '../src/sim/cabinet';

/** Idealised machine: gantry and winch follow commands exactly; the claw lands at `floorLen`. */
class FakeMachine implements MachineIO {
  pos: [number, number] = [CABINET.home.x, CABINET.home.y];
  vel: [number, number] = [0, 0];
  winch = 0;
  volts = 0;
  cableLimit: number = CABINET.ropeTop;
  floorLen = 0.5;
  voltLog: Array<[number, number]> = [];
  get cableLength(): number {
    return Math.min(this.cableLimit, this.floorLen);
  }
  get cableSlack(): number {
    return this.cableLimit - this.cableLength;
  }
  gantryPos(): [number, number] {
    return [...this.pos];
  }
  setGantryVelocity(vx: number, vy: number): void {
    this.vel = [vx, vy];
  }
  setWinchVelocity(v: number): void {
    this.winch = v;
  }
  setClawVoltage(v: number): void {
    this.volts = v;
  }
  step(dt: number): void {
    this.pos[0] = Math.max(CABINET.travel.x0, Math.min(CABINET.travel.x1, this.pos[0] + this.vel[0] * dt));
    this.pos[1] = Math.max(CABINET.travel.y0, Math.min(CABINET.travel.y1, this.pos[1] + this.vel[1] * dt));
    this.cableLimit = Math.max(CABINET.ropeMin, Math.min(CABINET.ropeMax, this.cableLimit + this.winch * dt));
    // A slack cable is wound in without moving the claw.
    if (this.winch < 0 && this.cableLimit > this.cableLength + 0.002) this.cableLimit = this.cableLength + 0.002;
  }
}

function run(board: Board, m: FakeMachine, seconds: number, until?: () => boolean): void {
  const dt = 0.002;
  for (let t = 0; t < seconds; t += dt) {
    board.update(dt, m);
    m.step(dt);
    m.voltLog.push([m.cableLimit, m.volts]);
    if (until?.()) return;
  }
}

function setup(overrides: Partial<Settings> = {}) {
  const s = { ...defaultSettings(), ...overrides };
  const board = new Board(s, () => 0.5);
  const m = new FakeMachine();
  return { board, m, s };
}

describe('Feiluoli board flow', () => {
  test('coin starts a game; timer expiry drops the claw automatically', () => {
    const { board, m } = setup({ A2: 5 });
    board.insertCoin();
    expect(board.state).toBe('play');
    expect(board.timeLeft).toBe(5);
    run(board, m, 5.2);
    expect(['dropDelay', 'dropping']).toContain(board.state);
  });

  test('A1: each coin is worth 一投, a game costs 每局 (每局 5 元 = 投 10 元玩兩次)', () => {
    const { board, m } = setup({ A1a: 10, A1b: 5 });
    board.insertCoin();
    expect(board.state).toBe('play');
    expect(board.credit).toBe(5);
    board.pressGrab();
    run(board, m, 30, () => board.state === 'idle');
    // The second game starts on the remaining credit.
    run(board, m, 0.01);
    expect(board.state).toBe('play');
    expect(board.credit).toBe(0);
    expect(board.accounts.games).toBe(2);
  });

  test('full cycle runs strong → medium at B4 → weak → off, and returns home', () => {
    const { board, m, s } = setup({ B1: 40, B2: 20, B3: 10, B4: 10, A2: 15 });
    board.insertCoin();
    board.setJoystick(1, 1);
    run(board, m, 1);
    board.setJoystick(0, 0);
    board.pressGrab();
    run(board, m, 30, () => board.state === 'idle');
    expect(board.state).toBe('idle');
    expect(m.pos[0]).toBeCloseTo(CABINET.home.x, 2);
    expect(m.pos[1]).toBeCloseTo(CABINET.home.y, 2);
    const strong = m.voltLog.filter(([, v]) => v === 40);
    const medium = m.voltLog.filter(([, v]) => v === 20);
    expect(strong.length).toBeGreaterThan(0);
    expect(medium.length).toBeGreaterThan(0);
    // Strong → medium happens B4 × step from the top.
    const firstMedium = m.voltLog.find(([, v]) => v === 20)!;
    expect(firstMedium[0] - CABINET.ropeTop).toBeLessThanOrEqual(s.B4 * B4_STEP + 0.002);
    expect(firstMedium[0] - CABINET.ropeTop).toBeGreaterThan(s.B4 * B4_STEP - 0.02);
    expect(m.voltLog.some(([, v]) => v === 10)).toBe(true);
    expect(m.volts).toBe(0);
  });

  test('B4 larger = switches to medium earlier (further from the top)', () => {
    const switchAt = (b4: number) => {
      const { board, m } = setup({ B1: 40, B2: 20, B4: b4 });
      board.insertCoin();
      board.pressGrab();
      run(board, m, 30, () => board.state === 'idle');
      return m.voltLog.find(([, v]) => v === 20)![0];
    };
    expect(switchAt(22)).toBeGreaterThan(switchAt(5));
  });

  test('A14 line length: a short drop time stops the claw in mid-air', () => {
    const { board, m } = setup({ A14: 0.5, E5: 100 });
    board.insertCoin();
    board.pressGrab();
    run(board, m, 3, () => board.state === 'closing');
    expect(m.cableLimit).toBeLessThan(CABINET.ropeTop + 0.5 * 0.33);
    expect(m.cableSlack).toBe(0);
  });

  test('A6 空中取物: a second press closes the claw mid-air only when enabled', () => {
    for (const [a6, expectMidAir] of [
      [1, true],
      [0, false],
    ] as const) {
      const { board, m } = setup({ A6a: a6, A6b: 0, A14: 3 });
      board.insertCoin();
      board.pressGrab();
      run(board, m, 0.4);
      board.pressGrab();
      run(board, m, 3, () => board.state === 'closing');
      expect(m.cableSlack > 0.005).toBe(!expectMidAir);
    }
  });

  test('A8 下爪延遲 delays the drop', () => {
    const { board, m } = setup({ A8a: 1 });
    board.insertCoin();
    board.pressGrab();
    run(board, m, 0.9);
    expect(board.state).toBe('dropDelay');
    run(board, m, 0.2);
    expect(board.state).toBe('dropping');
  });

  test('A9 上停延遲 holds at the top before returning', () => {
    const { board, m } = setup({ A9: 1, A12a: 0 });
    board.insertCoin();
    board.pressGrab();
    run(board, m, 20, () => board.state === 'topWait');
    run(board, m, 0.8);
    expect(board.state).toBe('topWait');
    run(board, m, 0.4);
    expect(board.state).not.toBe('topWait');
  });

  test('A12 上停上拉 reels into the stop tube; 回停下降 lowers before releasing', () => {
    const { board, m } = setup({ A12a: 10, A12b: 5 });
    board.insertCoin();
    board.pressGrab();
    let minLen = Infinity;
    let lowered = 0;
    run(board, m, 30, () => {
      minLen = Math.min(minLen, m.cableLimit);
      if (board.state === 'releasing') lowered = Math.max(lowered, m.cableLimit - CABINET.ropeTop);
      return board.state === 'idle';
    });
    expect(minLen).toBeLessThan(CABINET.ropeTop);
    expect(lowered).toBeGreaterThan(0.1);
  });

  test('保夾: once 累加金額 reaches A3 the game runs on B5 all the way home', () => {
    const { board, m } = setup({ A1a: 10, A1b: 10, A3: 30, B1: 20, B2: 10, B3: 5, B5: 48 });
    for (let g = 0; g < 3; g++) {
      m.voltLog = [];
      board.insertCoin();
      expect(board.guaranteed).toBe(g === 2);
      board.pressGrab();
      run(board, m, 30, () => board.state === 'idle');
    }
    // During the guaranteed game nothing but B5 or off was used.
    const lastGame = m.voltLog.filter(([, v]) => v > 0);
    expect(lastGame.every(([, v]) => v === 48)).toBe(true);
    expect(board.accumulated).toBe(30);
    board.prizeDropped();
    expect(board.accumulated).toBe(0);
    expect(board.accounts.wins).toBe(1);
    expect(board.accounts.history[0]).toBe(30);
    expect(board.accounts.bank).toBe(0);
  });

  test('A4 累加保留: accumulated credit expires after the set minutes idle', () => {
    const { board, m } = setup({ A4b: 1 });
    board.insertCoin();
    board.pressGrab();
    run(board, m, 30, () => board.state === 'idle');
    expect(board.accumulated).toBe(10);
    run(board, m, 61);
    expect(board.accumulated).toBe(0);
  });

  test('A7 投幣儲存=歸零: long press clears remaining credit', () => {
    const { board, m } = setup({ A7: 1, A1b: 20 });
    board.insertCoin();
    expect(board.state).toBe('idle');
    board.holdGrab(true);
    run(board, m, 2.2);
    expect(board.credit).toBe(0);
  });

  test('A13 促銷: every N paid games grants a free game', () => {
    const { board, m } = setup({ A13: 2 });
    for (let i = 0; i < 2; i++) {
      board.insertCoin();
      board.pressGrab();
      run(board, m, 30, () => board.state === 'idle');
    }
    run(board, m, 0.01);
    expect(board.state).toBe('play');
    expect(board.freeGame).toBe(true);
  });

  test('D 自動模式 免費: first game after 5 s, then every 10 s', () => {
    const { board, m } = setup({ D: 1, A2: 5 });
    run(board, m, 4.9);
    expect(board.state).toBe('idle');
    run(board, m, 0.2);
    expect(board.state).toBe('play');
    expect(board.freeGame).toBe(true);
    run(board, m, 40, () => board.state === 'idle');
    run(board, m, 9.8);
    expect(board.state).toBe('idle');
    run(board, m, 0.3);
    expect(board.state).toBe('play');
  });

  test('test-play key and free games are not booked', () => {
    const { board, m } = setup();
    board.testPlay();
    board.pressGrab();
    run(board, m, 30, () => board.state === 'idle');
    expect(board.accounts.games).toBe(0);
    board.prizeDropped();
    expect(board.accounts.wins).toBe(0);
  });

  test('E speeds scale gantry movement per direction', () => {
    const { board, m } = setup({ E4: 50, E3: 100 });
    board.insertCoin();
    board.setJoystick(1, 0);
    run(board, m, 2);
    const x0 = m.pos[0];
    run(board, m, 0.5);
    const right = m.pos[0] - x0;
    board.setJoystick(-1, 0);
    const x1 = m.pos[0];
    run(board, m, 0.5);
    const left = x1 - m.pos[0];
    expect(left / right).toBeGreaterThan(1.8);
  });
});
