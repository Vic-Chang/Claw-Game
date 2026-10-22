import type { BoardSnapshot } from '../machine/controller';

export interface HudCallbacks {
  onJoystick(x: number, y: number): void;
  onGrab(): void;
  onGrabHold(down: boolean): void;
  onCoin(): void;
  onView(): void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Player controls: on-screen joystick (touch/mouse), keyboard, coin and grab buttons. */
export class Hud {
  private keys = new Set<string>();
  private touchVec: [number, number] = [0, 0];
  private lastJoy: [number, number] = [0, 0];
  private grabDown = false;

  constructor(private cb: HudCallbacks) {
    this.bindJoystick();
    this.bindKeys();
    const grab = $('btn-grab');
    grab.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.cb.onGrab();
      this.setGrabDown(true);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) grab.addEventListener(ev, () => this.setGrabDown(false));
    $('btn-coin').addEventListener('click', () => this.cb.onCoin());
    $('btn-view').addEventListener('click', () => this.cb.onView());
  }

  private setGrabDown(v: boolean): void {
    if (this.grabDown === v) return;
    this.grabDown = v;
    this.cb.onGrabHold(v);
  }

  private bindJoystick(): void {
    const base = document.querySelector<HTMLElement>('#joystick .base')!;
    const knob = base.querySelector<HTMLElement>('.knob')!;
    let active: number | null = null;
    const move = (e: PointerEvent) => {
      const r = base.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      let dx = (e.clientX - cx) / (r.width / 2);
      let dy = (e.clientY - cy) / (r.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        dx /= len;
        dy /= len;
      }
      knob.style.transform = `translate(${dx * r.width * 0.3}px, ${dy * r.height * 0.3}px)`;
      // A real claw joystick is an 8-way switch: snap to on/off per axis.
      const t = 0.35;
      this.touchVec = [Math.abs(dx) > t ? Math.sign(dx) : 0, Math.abs(dy) > t ? -Math.sign(dy) : 0];
      this.emitJoy();
    };
    base.addEventListener('pointerdown', (e) => {
      active = e.pointerId;
      base.setPointerCapture(e.pointerId);
      move(e);
    });
    base.addEventListener('pointermove', (e) => {
      if (e.pointerId === active) move(e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== active) return;
      active = null;
      knob.style.transform = '';
      this.touchVec = [0, 0];
      this.emitJoy();
    };
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);
  }

  private bindKeys(): void {
    const typing = () => {
      const el = document.activeElement;
      return el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;
    };
    window.addEventListener('keydown', (e) => {
      if (typing()) return;
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'enter') {
        e.preventDefault();
        if (!e.repeat) this.cb.onGrab();
        this.setGrabDown(true);
        return;
      }
      if (k === 'c' && !e.repeat) this.cb.onCoin();
      if (k === 'v' && !e.repeat) this.cb.onView();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) {
        e.preventDefault();
        this.keys.add(k);
        this.emitJoy();
      }
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'enter') this.setGrabDown(false);
      this.keys.delete(k);
      this.emitJoy();
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.emitJoy();
    });
  }

  private emitJoy(): void {
    const k = this.keys;
    let x = (k.has('arrowright') || k.has('d') ? 1 : 0) - (k.has('arrowleft') || k.has('a') ? 1 : 0);
    let y = (k.has('arrowup') || k.has('w') ? 1 : 0) - (k.has('arrowdown') || k.has('s') ? 1 : 0);
    if (x === 0 && y === 0) [x, y] = this.touchVec;
    if (x !== this.lastJoy[0] || y !== this.lastJoy[1]) {
      this.lastJoy = [x, y];
      this.cb.onJoystick(x, y);
    }
  }

  get grabHeld(): boolean {
    return this.grabDown;
  }

  update(b: BoardSnapshot, remaining: number, coinValue: number): void {
    $('hud-credit').textContent = String(b.credit);
    $('hud-time').textContent = b.state === 'play' ? String(Math.ceil(b.timeLeft)) : '--';
    $('hud-acc-wrap').style.display = b.showAccumulated ? '' : 'none';
    $('hud-acc').textContent = String(b.accumulated);
    $('hud-left').textContent = String(remaining);
    $('coin-label').textContent = `${coinValue} 元`;
    $('hud-msg').textContent = message(b);
  }
}

function message(b: BoardSnapshot): string {
  if (b.errorCode) return `故障 ${b.errorCode}（請叫店員：台主模式 → 中控面板）`;
  const tag = b.guaranteed ? '【保夾】' : b.freeGame ? '【免費】' : '';
  switch (b.state) {
    case 'idle':
      return b.autoMode && b.autoCountdown > 0 ? `自動模式 ${b.autoCountdown.toFixed(0)} 秒後開始` : '投幣開始遊戲';
    case 'play':
      return `${tag}遊戲開始 祝您中獎！`;
    case 'dropDelay':
    case 'dropping':
      return `${tag}下爪中…（可再按取物鍵空中取物）`;
    case 'closing':
      return '合爪！';
    case 'lifting':
    case 'topPull':
    case 'topWait':
      return '上升中…';
    case 'returning':
    case 'lowering':
      return '回到出口…';
    case 'releasing':
    case 'rewind':
      return '開爪';
    case 'retry':
      return '上停異常理線，重新下爪';
    default:
      return '';
  }
}
