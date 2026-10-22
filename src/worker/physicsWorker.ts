/// <reference lib="webworker" />
import { Board, type BoardEvent } from '../machine/controller';
import { ClawSimulation } from '../sim/simulation';
import { layoutPrizes } from '../sim/prizes';
import type { FromWorker, GeomInfo, ToWorker } from './protocol';

/**
 * The machine runs here: MuJoCo physics stepped at 500 Hz with the control board updated
 * every sub-step. The main thread only renders and handles UI.
 */

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let sim: ClawSimulation | null = null;
let board: Board | null = null;
let joy: [number, number] = [0, 0];
let paused = false;
let knocks: number[] = [];
let pending: ToWorker[] = [];
let costEma = 0;
let awaitingAck = false;
let heldEvents: BoardEvent[] = [];

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

function sendModel(): void {
  if (!sim) return;
  const m = sim.model;
  const geoms: GeomInfo[] = [];
  for (let i = 0; i < m.ngeom; i++) {
    geoms.push({
      name: sim.geomName(i),
      type: m.geom_type[i],
      size: [m.geom_size[i * 3], m.geom_size[i * 3 + 1], m.geom_size[i * 3 + 2]],
      rgba: [m.geom_rgba[i * 4], m.geom_rgba[i * 4 + 1], m.geom_rgba[i * 4 + 2], m.geom_rgba[i * 4 + 3]],
      body: m.geom_bodyid[i],
      group: m.geom_group[i],
    });
  }
  const prizeOfBody: number[] = new Array(m.nbody).fill(-1);
  sim.ids.prizeBodies.forEach((root, p) => {
    for (let b = 0; b < m.nbody; b++) if (m.body_rootid[b] === root) prizeOfBody[b] = p;
  });
  post({ type: 'model', geoms, prizeOfBody });
}

function hookEvents(): void {
  if (!sim) return;
  sim.events = {
    onPrizeDrop: () => board?.prizeDropped(),
    onKnock: (s) => knocks.push(s),
  };
}

async function handle(msg: ToWorker): Promise<void> {
  switch (msg.type) {
    case 'init': {
      board = new Board(msg.settings);
      sim = await ClawSimulation.create(msg.claw, layoutPrizes(msg.counts, msg.seed), msg.guardCm / 100);
      hookEvents();
      sim.reset();
      sendModel();
      break;
    }
    case 'input':
      joy = msg.joy;
      board?.setJoystick(joy[0], joy[1]);
      board?.holdGrab(msg.grabDown);
      break;
    case 'grab':
      board?.pressGrab();
      break;
    case 'coin':
      board?.insertCoin();
      break;
    case 'testPlay':
      board?.testPlay();
      break;
    case 'settings':
      board?.updateSettings(msg.settings);
      break;
    case 'claw':
      if (sim) {
        sim.setClawTuning(msg.claw);
        hookEvents();
        sendModel();
      }
      break;
    case 'prizes':
      if (sim) {
        sim.setPrizes(layoutPrizes(msg.counts, msg.seed));
        hookEvents();
        sendModel();
      }
      break;
    case 'guard':
      if (sim) {
        sim.setGuardHeight(msg.heightCm / 100);
        hookEvents();
        sendModel();
      }
      break;
    case 'clearAccounts':
      board?.clearAccounts();
      break;
    case 'clearBank':
      board?.clearBank();
      break;
    case 'resetError':
      board?.resetError();
      break;
    case 'pause':
      paused = msg.paused;
      break;
    case 'ack':
      awaitingAck = false;
      break;
  }
}

ctx.onmessage = (e: MessageEvent<ToWorker>) => {
  if (e.data.type === 'ack') awaitingAck = false;
  else pending.push(e.data);
};

let last = performance.now();
let busy = false;

async function tick(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const msgs = pending;
    pending = [];
    for (const m of msgs) await handle(m);
    const now = performance.now();
    // Never try to catch up more than 50 ms (tab was hidden, etc.).
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!sim || !board) return;
    const b = board;
    const s = sim;
    if (!paused && dt > 0) {
      const t0 = performance.now();
      s.step(dt, (h) => b.update(h, s));
      const cost = (performance.now() - t0) / dt;
      costEma = costEma ? costEma * 0.95 + cost * 0.05 : cost;
    }
    sendFrame();
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  } finally {
    busy = false;
  }
}

function sendFrame(): void {
  if (!sim || !board) return;
  // Keep board events until the page can take a frame; never queue frames up.
  heldEvents.push(...board.takeEvents());
  if (awaitingAck) return;
  awaitingAck = true;
  const d = sim.data;
  const geomPos = new Float32Array(d.geom_xpos);
  const geomMat = new Float32Array(d.geom_xmat);
  const p0 = sim.sitePos('pulley');
  const p1 = sim.sitePos('rope_bot');
  const events = heldEvents;
  heldEvents = [];
  post(
    {
      type: 'frame',
      geomPos,
      geomMat,
      cable: [p0[0], p0[1], p0[2], p1[0], p1[1], p1[2]],
      board: board.snapshot(),
      events,
      knocks,
      remaining: sim.remainingPrizes(),
      debug: {
        time: sim.time,
        volts: sim.solenoid.volts,
        current: sim.solenoid.current,
        closure: sim.armClosure(),
        cableSlack: sim.cableSlack,
        cableLimit: sim.cableLimit,
        head: sim.headPos(),
        gantry: sim.gantryPos(),
        cost: costEma,
      },
    },
    [geomPos.buffer, geomMat.buffer],
  );
  knocks = [];
}

setInterval(() => void tick(), 1000 / 60);
