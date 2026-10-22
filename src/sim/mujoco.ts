import loadMujoco, { type MainModule } from '@mujoco/mujoco';

export type Mujoco = MainModule;

let instance: Promise<Mujoco> | null = null;

/** Loads the MuJoCo WASM module once and shares it (works in browser, worker and Node). */
export function getMujoco(): Promise<Mujoco> {
  if (!instance) instance = loadMujoco();
  return instance;
}
