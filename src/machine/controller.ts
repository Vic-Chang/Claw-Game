import { CABINET } from '../sim/cabinet';
import type { Settings } from './settings';

/** What the control board can sense and drive on the machine. */
export interface MachineIO {
  gantryPos(): [number, number];
  setGantryVelocity(vx: number, vy: number): void;
  /** + pays cable out (claw down). */
  setWinchVelocity(v: number): void;
  setClawVoltage(v: number): void;
  readonly cableLimit: number;
  readonly cableLength: number;
  readonly cableSlack: number;
}

export type BoardState =
  | 'idle'
  | 'play'
  | 'dropDelay'
  | 'dropping'
  | 'closing'
  | 'lifting'
  | 'topPull'
  | 'topWait'
  | 'returning'
  | 'lowering'
  | 'releasing'
  | 'rewind'
  | 'retry'
  | 'error';

export type BoardEvent =
  | { type: 'coin'; credit: number }
  | { type: 'start'; guaranteed: boolean; free: boolean }
  | { type: 'drop' }
  | { type: 'grab' }
  | { type: 'win'; spent: number }
  | { type: 'end' }
  | { type: 'music' }
  | { type: 'voltage'; volts: number; stage: 'strong' | 'medium' | 'weak' | 'off' | 'guaranteed' }
  | { type: 'error'; code: string };

export interface Accounts {
  /** C1 中獎率銀行: money put in since the last prize. */
  bank: number;
  /** C2 投幣遊戲次數. */
  games: number;
  /** C3 禮品出獎次數. */
  wins: number;
  /** C4 累加金額查詢: cost of the last 10 prizes, newest first. */
  history: number[];
  /** F2 投幣器測試 counter. */
  coins: number;
}

/** Full-speed (100 %) mechanical speeds of the standard cabinet. */
export const GANTRY_SPEED = 0.2; // m/s
export const WINCH_SPEED = 0.32; // m/s
/** E5 = 100 % drop speed; the winch pays out faster than it reels in. */
export const WINCH_DOWN_SPEED = 0.48; // m/s
/** A12 回停下降 lowers at this fixed speed, whatever E5 is set to. */
export const HOME_LOWER_SPEED = 0.1; // m/s
/** One step of 中壓距離頂點 in metres of cable from the top. */
export const B4_STEP = 0.018;

const HOME_TOL = 0.004;

export interface BoardSnapshot {
  state: BoardState;
  /** Money credit available (元). */
  credit: number;
  /** Seconds left in the current game. */
  timeLeft: number;
  /** 累加金額 towards the guaranteed prize. */
  accumulated: number;
  showAccumulated: boolean;
  guaranteed: boolean;
  freeGame: boolean;
  volts: number;
  voltStage: 'strong' | 'medium' | 'weak' | 'off' | 'guaranteed';
  accounts: Accounts;
  eyeBlocked: boolean;
  errorCode: string | null;
  autoMode: number;
  /** Seconds until the next free/test game in auto mode. */
  autoCountdown: number;
}

/**
 * The Feiluoli control board: game flow, claw voltage stages, motor drive, guaranteed
 * prize (保夾) logic and the books.
 */
export class Board {
  settings: Settings;
  state: BoardState = 'idle';
  credit = 0;
  timeLeft = 0;
  accumulated = 0;
  guaranteed = false;
  freeGame = false;
  /** Free games granted by A13 promotion. */
  promoGames = 0;
  paidSincePromo = 0;
  accounts: Accounts = { bank: 0, games: 0, wins: 0, history: [], coins: 0 };
  volts = 0;
  voltStage: BoardSnapshot['voltStage'] = 'off';
  errorCode: string | null = null;
  eyeBlocked = false;
  events: BoardEvent[] = [];

  private joy: [number, number] = [0, 0];
  private grabPressed = false;
  private stateTime = 0;
  private dropDelay = 0;
  private dropSpeedFactor = 1;
  private secondCatch: number | null = null;
  private lastActivity = 0;
  private now = 0;
  private musicTimer = 0;
  private retries = 0;
  private wonThisGame = false;
  private autoTimer = 5;
  private grabHoldTime = 0;
  private stallTime = 0;
  /** Cable length the claw rests at between games: A12 回停下降 leaves it below the plate. */
  private restLen: number = CABINET.ropeTop;
  private autoTarget: [number, number] | null = null;
  private rand: () => number;

  constructor(settings: Settings, rand: () => number = Math.random) {
    this.settings = { ...settings };
    this.rand = rand;
  }

  private s(code: string): number {
    return this.settings[code] ?? 0;
  }

  private emit(e: BoardEvent): void {
    this.events.push(e);
  }

  /** Drains queued events (for sound/UI). */
  takeEvents(): BoardEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  updateSettings(s: Settings): void {
    this.settings = { ...s };
  }

  // ---- Player / operator inputs -------------------------------------------------------

  insertCoin(): void {
    this.accounts.coins++;
    this.credit += this.s('A1a');
    this.lastActivity = this.now;
    this.emit({ type: 'coin', credit: this.credit });
    if (this.state === 'idle') this.tryStartGame();
  }

  setJoystick(x: number, y: number): void {
    this.joy = [Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y))];
  }

  /** 取物鍵 pressed. */
  pressGrab(): void {
    this.grabPressed = true;
  }

  /** Hold state of the grab button (for A7 long-press clear). */
  holdGrab(down: boolean): void {
    if (!down) this.grabHoldTime = 0;
    else if (this.grabHoldTime === 0) this.grabHoldTime = 1e-6;
  }

  /** Operator 試玩鍵: a free game that is not booked. */
  testPlay(): void {
    if (this.state !== 'idle') return;
    this.startGame(true);
  }

  clearAccounts(): void {
    this.accounts = { bank: 0, games: 0, wins: 0, history: [], coins: 0 };
  }

  clearBank(): void {
    this.accounts.bank = 0;
  }

  /** Called by the machine when the chute electric eye sees a prize. */
  prizeDropped(): void {
    this.eyeBlocked = true;
    this.wonThisGame = true;
    if (this.freeGame) return;
    const spent = this.accounts.bank;
    this.accounts.wins++;
    this.accounts.history.unshift(spent);
    this.accounts.history.length = Math.min(10, this.accounts.history.length);
    this.accounts.bank = 0;
    this.accumulated = 0;
    this.guaranteed = false;
    this.emit({ type: 'win', spent });
  }

  // ---- Game flow ----------------------------------------------------------------------

  private tryStartGame(): boolean {
    if (this.promoGames > 0) {
      this.promoGames--;
      this.startGame(true);
      return true;
    }
    const price = this.s('A1b');
    if (this.credit < price) return false;
    this.credit -= price;
    this.accumulated += price;
    this.accounts.bank += price;
    this.accounts.games++;
    const promo = this.s('A13');
    if (promo > 0 && ++this.paidSincePromo >= promo) {
      this.paidSincePromo = 0;
      this.promoGames++;
    }
    this.startGame(false);
    return true;
  }

  private startGame(free: boolean): void {
    this.freeGame = free;
    this.guaranteed = !free && this.accumulated >= this.s('A3');
    this.wonThisGame = false;
    this.timeLeft = this.s('A2');
    this.grabPressed = false;
    this.retries = 0;
    this.lastActivity = this.now;
    this.setState('play');
    this.emit({ type: 'start', guaranteed: this.guaranteed, free });
  }

  private setState(s: BoardState): void {
    this.state = s;
    this.stateTime = 0;
  }

  private setVoltage(stage: 'strong' | 'medium' | 'weak' | 'off', io: MachineIO): void {
    // 保夾局: B5 all the way from the grab until the claw opens at home.
    const shown: BoardSnapshot['voltStage'] = this.guaranteed && stage !== 'off' ? 'guaranteed' : stage;
    const v =
      shown === 'guaranteed' ? this.s('B5') : stage === 'strong' ? this.s('B1') : stage === 'medium' ? this.s('B2') : stage === 'weak' ? this.s('B3') : 0;
    if (v !== this.volts || shown !== this.voltStage) {
      this.volts = v;
      this.voltStage = shown;
      this.emit({ type: 'voltage', volts: v, stage: shown });
    }
    io.setClawVoltage(v);
  }

  private gantryDrive(dirX: number, dirY: number, io: MachineIO): void {
    const e8 = [1, 1.2, 1.4][this.s('E8')] ?? 1;
    // Faster gearing slips: the carriage moves in little jerks (打滑).
    const slip = e8 > 1 ? 1 - (e8 - 1) * 1.1 * Math.max(0, Math.sin(this.now * 2 * Math.PI * 7)) : 1;
    const sx = dirX < 0 ? this.s('E3') : this.s('E4');
    const sy = dirY < 0 ? this.s('E1') : this.s('E2');
    io.setGantryVelocity(dirX * GANTRY_SPEED * (sx / 100) * e8 * slip, dirY * GANTRY_SPEED * (sy / 100) * e8 * slip);
  }

  private driveTo(x: number, y: number, io: MachineIO): boolean {
    const [gx, gy] = io.gantryPos();
    const dx = x - gx;
    const dy = y - gy;
    const ax = Math.abs(dx) < HOME_TOL ? 0 : Math.sign(dx) * Math.min(1, Math.abs(dx) / 0.02);
    const ay = Math.abs(dy) < HOME_TOL ? 0 : Math.sign(dy) * Math.min(1, Math.abs(dy) / 0.02);
    this.gantryDrive(ax, ay, io);
    return ax === 0 && ay === 0;
  }

  /** Advances the board by dt seconds, reading/writing the machine. */
  update(dt: number, io: MachineIO): void {
    this.now += dt;
    this.stateTime += dt;
    if (this.grabHoldTime > 0) this.grabHoldTime += dt;
    const top = CABINET.ropeTop;

    switch (this.state) {
      case 'idle': {
        io.setGantryVelocity(0, 0);
        io.setWinchVelocity(0);
        this.setVoltage('off', io);
        this.idleHousekeeping(dt);
        if (this.credit >= this.s('A1b') || this.promoGames > 0) this.tryStartGame();
        else this.autoMode(dt, io);
        break;
      }
      case 'play': {
        this.timeLeft = Math.max(0, this.timeLeft - dt);
        if (this.autoTarget) {
          if (this.driveTo(this.autoTarget[0], this.autoTarget[1], io)) this.grabPressed = true;
        } else {
          this.gantryDrive(this.joy[0], this.joy[1], io);
        }
        if (this.grabPressed || this.timeLeft <= 0) {
          this.grabPressed = false;
          io.setGantryVelocity(0, 0);
          const a8 = this.s('A8a');
          this.dropDelay = this.s('A8b') === 1 ? this.rand() * a8 : a8;
          const slow = this.s('A10a') / 100;
          this.dropSpeedFactor = 1 - this.rand() * slow;
          this.secondCatch = null;
          this.autoTarget = null;
          this.setState('dropDelay');
        }
        break;
      }
      case 'dropDelay': {
        io.setGantryVelocity(0, 0);
        if (this.stateTime >= this.dropDelay) {
          this.setState('dropping');
          this.emit({ type: 'drop' });
        }
        break;
      }
      case 'dropping': {
        io.setGantryVelocity(0, 0);
        io.setWinchVelocity(WINCH_DOWN_SPEED * (this.s('E5') / 100) * this.dropSpeedFactor);
        // 二收: second press of the grab button closes the claw in mid-air.
        if (this.grabPressed && this.s('A6a') === 1 && this.secondCatch === null) {
          const d = this.s('A6b');
          this.secondCatch = this.stateTime + (this.s('A10b') === 1 ? this.rand() * Math.max(d, 0.5) : d);
        }
        this.grabPressed = false;
        const landed = io.cableSlack > 0.008 && this.stateTime > 0.15;
        const timeUp = this.stateTime >= this.s('A14');
        const caught = this.secondCatch !== null && this.stateTime >= this.secondCatch;
        if (landed || timeUp || caught) {
          io.setWinchVelocity(0);
          this.setState('closing');
          this.setVoltage('strong', io);
          this.emit({ type: 'grab' });
        }
        break;
      }
      case 'closing': {
        io.setWinchVelocity(0);
        this.setVoltage('strong', io);
        // The winch reverses almost at once (A11 = 0 "它馬上就起來了"); taking the head's
        // weight off the tips lets the arms swing in while the claw starts to rise.
        if (this.stateTime >= 0.08 + this.s('A11')) {
          this.stallTime = 0;
          this.setState('lifting');
        }
        break;
      }
      case 'lifting': {
        io.setWinchVelocity(-WINCH_SPEED * (this.s('E6') / 100));
        const fromTop = io.cableLimit - top;
        this.setVoltage(fromTop <= this.s('B4') * B4_STEP ? 'medium' : 'strong', io);
        // G3 上停異常理線: the claw can't come up (snagged).
        if (io.cableLength - io.cableLimit > 0.03) this.stallTime += dt;
        else this.stallTime = 0;
        if (this.stallTime > 1.2) {
          this.retries++;
          if (this.retries > 3) {
            this.errorCode = 'E3 上停異常';
            this.emit({ type: 'error', code: this.errorCode });
            this.setState('error');
          } else {
            this.setState('retry');
          }
          break;
        }
        if (io.cableLimit <= top + 1e-4) {
          this.setState('topPull');
        }
        break;
      }
      case 'retry': {
        // Lower again with the claw open or closed (G3), then lift once more.
        this.setVoltage(this.s('G3') === 0 ? 'off' : 'strong', io);
        io.setWinchVelocity(WINCH_SPEED * 0.5);
        if (this.stateTime > 0.6) {
          io.setWinchVelocity(0);
          this.setVoltage('strong', io);
          this.stallTime = 0;
          this.setState('lifting');
        }
        break;
      }
      case 'topPull': {
        // A12 上停上拉: keep reeling into the anti-swing plate for A12a × 0.1 s — the jolt that throws.
        const pull = this.s('A12a') * 0.1;
        this.setVoltage('medium', io);
        io.setWinchVelocity(this.stateTime < pull ? -WINCH_SPEED * (this.s('E6') / 100) : 0);
        if (this.stateTime >= pull) {
          // Spring back to the normal top stop.
          io.setWinchVelocity(0);
          this.setState('topWait');
        }
        break;
      }
      case 'topWait': {
        io.setWinchVelocity(io.cableLimit < top ? WINCH_SPEED * 0.5 : 0);
        this.setVoltage('medium', io);
        if (this.stateTime >= this.s('A9') && io.cableLimit >= top - 1e-4) {
          io.setWinchVelocity(0);
          this.setState('returning');
        }
        break;
      }
      case 'returning': {
        this.setVoltage('weak', io);
        io.setWinchVelocity(0);
        if (this.driveTo(CABINET.home.x, CABINET.home.y, io)) {
          io.setGantryVelocity(0, 0);
          if (this.stateTime > 0.1) this.setState('lowering');
        }
        break;
      }
      case 'lowering': {
        io.setGantryVelocity(0, 0);
        this.setVoltage('weak', io);
        const t = this.s('A12b') * 0.1;
        io.setWinchVelocity(this.stateTime < t ? HOME_LOWER_SPEED : 0);
        if (this.stateTime >= t) {
          // Stays at this height from now on — the gap to the anti-swing plate is the point.
          this.restLen = io.cableLimit;
          this.setState('releasing');
        }
        break;
      }
      case 'releasing': {
        io.setWinchVelocity(0);
        this.setVoltage('off', io);
        if (this.stateTime >= 1.0) this.setState('rewind');
        break;
      }
      case 'rewind': {
        // Back to the rest height, not the top (A12 回停下降 is not reeled back in).
        const diff = io.cableLimit - this.restLen;
        io.setWinchVelocity(diff > 1e-4 ? -WINCH_SPEED : diff < -1e-4 ? HOME_LOWER_SPEED : 0);
        if (Math.abs(diff) <= 1e-4 && this.stateTime > 0.3) this.endGame();
        break;
      }
      case 'error': {
        io.setGantryVelocity(0, 0);
        io.setWinchVelocity(0);
        this.setVoltage('off', io);
        break;
      }
    }
  }

  private endGame(): void {
    this.eyeBlocked = false;
    this.emit({ type: 'end' });
    this.lastActivity = this.now;
    this.setState('idle');
    if (this.s('D') !== 0) this.autoTimer = this.s('D') === 1 ? 10 : 15;
  }

  /** Clears an error after the operator opens the cabinet (key). */
  resetError(): void {
    this.errorCode = null;
    this.setState('rewind');
  }

  private idleHousekeeping(dt: number): void {
    // A4 累加保留: accumulated credit expires after N minutes without play.
    const keep = this.s('A4b');
    if (keep > 0 && this.accumulated > 0 && this.now - this.lastActivity > keep * 60) this.accumulated = 0;
    // A5 展示音樂.
    const every = this.s('A5');
    if (every > 0) {
      this.musicTimer += dt;
      if (this.musicTimer >= every * 60) {
        this.musicTimer = 0;
        this.emit({ type: 'music' });
      }
    }
    // A7 投幣儲存 = 歸零: long-press 取物鍵 2 s wipes remaining credit and 累保.
    if (this.s('A7') === 1 && this.grabHoldTime > 2) {
      this.credit = 0;
      this.accumulated = 0;
      this.grabHoldTime = 0;
    }
    this.grabPressed = false;
  }

  private autoMode(dt: number, io: MachineIO): void {
    const mode = this.s('D');
    if (mode === 0) {
      this.autoTimer = 5;
      return;
    }
    this.autoTimer -= dt;
    if (this.autoTimer > 0) return;
    if (mode === 1) {
      // 免費: first game after 5 s, then one every 10 s.
      this.startGame(true);
    } else {
      // 機台耐久測試: the machine plays itself at a random spot every 15 s.
      const t = CABINET.travel;
      this.autoTarget = [t.x0 + this.rand() * (t.x1 - t.x0), t.y0 + this.rand() * (t.y1 - t.y0)];
      this.startGame(true);
    }
    void io;
  }

  get autoCountdown(): number {
    return this.state === 'idle' && this.s('D') !== 0 ? Math.max(0, this.autoTimer) : 0;
  }

  snapshot(): BoardSnapshot {
    return {
      state: this.state,
      credit: this.credit,
      timeLeft: this.timeLeft,
      accumulated: this.accumulated,
      showAccumulated: this.s('A4a') === 1,
      guaranteed: this.guaranteed,
      freeGame: this.freeGame,
      volts: this.volts,
      voltStage: this.voltStage,
      accounts: { ...this.accounts, history: [...this.accounts.history] },
      eyeBlocked: this.eyeBlocked,
      errorCode: this.errorCode,
      autoMode: this.s('D'),
      autoCountdown: this.autoCountdown,
    };
  }

  /** Did this game end with a prize? */
  get won(): boolean {
    return this.wonThisGame;
  }
}
