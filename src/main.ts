import { cloneConfig, loadConfig, saveConfig } from './app/state';
import { Sound } from './audio/sfx';
import type { BoardSnapshot } from './machine/controller';
import { layoutPrizes } from './sim/prizes';
import { MachineScene, type ViewName } from './render/scene';
import { Hud } from './ui/hud';
import { drawLcd } from './ui/lcd';
import { OperatorPanel } from './ui/operatorPanel';
import type { FromWorker, ToWorker } from './worker/protocol';
import PhysicsWorker from './worker/physicsWorker?worker';

const config = loadConfig();
const scene = new MachineScene(document.getElementById('stage')!);
const worker: Worker = new PhysicsWorker();
const send = (m: ToWorker) => worker.postMessage(m);
const sound = new Sound(config.volume);

let board: BoardSnapshot | null = null;
let lastFrame: Extract<FromWorker, { type: 'frame' }> | null = null;
let geomNames: string[] = [];
let remaining = 0;
let operatorOpen = false;

const views: ViewName[] = ['front', 'side', 'top', 'claw'];
const viewLabel: Record<ViewName, string> = { front: '正面', side: '側面', top: '俯視', claw: '跟隨爪子' };
const viewBtn = document.getElementById('btn-view')!;

const hud = new Hud({
  onJoystick: (x, y) => send({ type: 'input', joy: [x, y], grabDown: hud.grabHeld }),
  onGrab: () => {
    sound.unlock();
    send({ type: 'grab' });
  },
  onGrabHold: (down) => send({ type: 'input', joy: [0, 0], grabDown: down }),
  onCoin: () => {
    sound.unlock();
    sound.coin();
    send({ type: 'coin' });
  },
  onView: () => {
    const next = views[(views.indexOf(scene.currentView) + 1) % views.length];
    scene.setView(next);
    viewBtn.textContent = `視角：${viewLabel[next]}`;
  },
});

const panel = new OperatorPanel(cloneConfig(config), {
  onSettings: (s) => {
    config.settings = s;
    saveConfig(config);
    send({ type: 'settings', settings: s });
  },
  onClaw: (c) => {
    config.claw = c;
    saveConfig(config);
    send({ type: 'claw', claw: c });
  },
  onPrizes: (counts, seed) => {
    config.counts = counts;
    config.seed = seed;
    saveConfig(config);
    send({ type: 'prizes', counts, seed });
  },
  onGuard: (cm) => {
    config.guardCm = cm;
    saveConfig(config);
    send({ type: 'guard', heightCm: cm });
  },
  onTestPlay: () => send({ type: 'testPlay' }),
  onClearAccounts: () => send({ type: 'clearAccounts' }),
  onClearBank: () => send({ type: 'clearBank' }),
  onResetError: () => send({ type: 'resetError' }),
});

document.getElementById('btn-operator')!.addEventListener('click', () => {
  operatorOpen = !operatorOpen;
  panel.setOpen(operatorOpen);
});
document.getElementById('op-close')!.addEventListener('click', () => {
  operatorOpen = false;
  panel.setOpen(false);
});

const soundBtn = document.getElementById('btn-sound')!;
soundBtn.addEventListener('click', () => {
  sound.unlock();
  config.volume = config.volume > 0 ? 0 : 0.6;
  sound.setVolume(config.volume);
  soundBtn.textContent = config.volume > 0 ? '🔊' : '🔇';
  saveConfig(config);
});
soundBtn.textContent = config.volume > 0 ? '🔊' : '🔇';

const toast = document.getElementById('toast')!;
let toastTimer = 0;
function showToast(text: string): void {
  toast.textContent = text;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 2600);
}

function lcdLines(b: BoardSnapshot): string[] {
  if (b.errorCode) return ['故障', b.errorCode, '請通知店員', ''];
  if (b.state === 'idle') {
    return [`投幣 ${b.credit}`, b.showAccumulated && b.accumulated > 0 ? `累保 ${b.accumulated} 元` : '', '◇ 歡迎光臨 ◇', ''];
  }
  return [`投幣 ${b.credit}   時間 ${b.state === 'play' ? Math.ceil(b.timeLeft) : 0}`, b.guaranteed ? '★ 保夾 ★' : '', '◇遊戲開始◇', '★祝您中獎★'];
}

let lastLcd = '';
let lastPanel = 0;
worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'model': {
      geomNames = msg.geoms.map((g) => g.name);
      const prizes = layoutPrizes(config.counts, config.seed);
      scene.setModel(
        msg.geoms,
        msg.prizeOfBody,
        prizes.map((p) => p.color),
        prizes.map((p) => p.kind),
      );
      document.getElementById('loading')!.hidden = true;
      break;
    }
    case 'frame': {
      lastFrame = msg;
      scene.updateFrame(msg.geomPos, msg.geomMat, msg.cable);
      board = msg.board;
      remaining = msg.remaining;
      hud.update(board, remaining, config.settings.A1a);
      const now = performance.now();
      if (now - lastPanel > 100) {
        lastPanel = now;
        panel.update(board, msg.debug);
      }
      for (const ev of msg.events) {
        sound.boardEvent(ev);
        if (ev.type === 'win') showToast(`🎉 恭喜中獎！\n本次花費 ${ev.spent} 元`);
        if (ev.type === 'start' && ev.guaranteed) showToast('★ 保夾局 ★');
        if (ev.type === 'error') showToast(`故障：${ev.code}`);
      }
      for (const k of msg.knocks) sound.knock(k);
      sound.motor(board.state);
      const lines = lcdLines(board);
      const key = lines.join('|');
      if (key !== lastLcd && scene.lcdCanvas) {
        lastLcd = key;
        drawLcd(scene.lcdCanvas, lines);
        scene.lcdUpdated();
      }
      requestAnimationFrame(() => send({ type: 'ack' }));
      break;
    }
    case 'error':
      console.error('physics worker:', msg.message);
      document.getElementById('loading')!.textContent = `物理引擎錯誤：${msg.message}`;
      document.getElementById('loading')!.hidden = false;
      break;
  }
};

send({ type: 'init', settings: config.settings, claw: config.claw, counts: config.counts, seed: config.seed, guardCm: config.guardCm });

document.addEventListener('visibilitychange', () => send({ type: 'pause', paused: document.hidden }));

function loop(): void {
  scene.render();
  requestAnimationFrame(loop);
}
loop();

// Exposed for automated browser tests.
(window as unknown as { claw: unknown }).claw = {
  send,
  get board() {
    return board;
  },
  get remaining() {
    return remaining;
  },
  get frame() {
    return lastFrame;
  },
  /** World position of a named geom in the latest frame. */
  geomPos(name: string): [number, number, number] | null {
    const i = geomNames.indexOf(name);
    if (i < 0 || !lastFrame) return null;
    const p = lastFrame.geomPos;
    return [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
  },
  geomNames: () => geomNames,
  config,
  scene,
};
