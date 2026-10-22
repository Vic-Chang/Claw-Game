import type { BoardEvent, BoardSnapshot } from '../machine/controller';
import type { Settings } from '../machine/settings';
import type { ClawTuning } from '../sim/clawConfig';
import type { PrizeCounts } from '../sim/prizes';

export interface GeomInfo {
  name: string;
  /** mjtGeom: 0 plane, 2 sphere, 3 capsule, 4 ellipsoid, 5 cylinder, 6 box. */
  type: number;
  size: [number, number, number];
  rgba: [number, number, number, number];
  body: number;
  group: number;
}

export type ToWorker =
  | { type: 'init'; settings: Settings; claw: ClawTuning; counts: PrizeCounts; seed: number }
  | { type: 'input'; joy: [number, number]; grabDown: boolean }
  | { type: 'grab' }
  | { type: 'coin' }
  | { type: 'testPlay' }
  | { type: 'settings'; settings: Settings }
  | { type: 'claw'; claw: ClawTuning }
  | { type: 'prizes'; counts: PrizeCounts; seed: number }
  | { type: 'clearAccounts' }
  | { type: 'clearBank' }
  | { type: 'resetError' }
  | { type: 'pause'; paused: boolean }
  /** The page finished handling the last frame (back-pressure for slow devices). */
  | { type: 'ack' };

export interface DebugInfo {
  time: number;
  volts: number;
  current: number;
  closure: number[];
  cableSlack: number;
  cableLimit: number;
  head: [number, number, number];
  gantry: [number, number];
  /** Physics wall time per simulated second (ms). */
  cost: number;
}

export type FromWorker =
  | { type: 'model'; geoms: GeomInfo[]; prizeOfBody: number[] }
  | {
      type: 'frame';
      geomPos: Float32Array;
      geomMat: Float32Array;
      cable: [number, number, number, number, number, number];
      board: BoardSnapshot;
      events: BoardEvent[];
      knocks: number[];
      debug: DebugInfo;
      remaining: number;
    }
  | { type: 'error'; message: string };
