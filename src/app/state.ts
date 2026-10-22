import { type Settings, loadSettings, saveSettings } from '../machine/settings';
import { type ClawTuning, cloneClawTuning, defaultClawTuning } from '../sim/clawConfig';
import { DEFAULT_COUNTS, type PrizeCounts } from '../sim/prizes';

/** Operator-side configuration that lives on the main thread and is mirrored to the worker. */
export interface AppConfig {
  settings: Settings;
  claw: ClawTuning;
  counts: PrizeCounts;
  seed: number;
  volume: number;
}

const KEY = 'feiluoli-machine-v1';

function readJson<T>(key: string): Partial<T> {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<T>) : {};
  } catch {
    return {};
  }
}

export function loadConfig(): AppConfig {
  const saved = readJson<Omit<AppConfig, 'settings'>>(KEY);
  const claw = defaultClawTuning();
  if (saved.claw && Array.isArray(saved.claw.arms) && saved.claw.arms.length === 3) {
    Object.assign(claw, saved.claw, { arms: saved.claw.arms.map((a, i) => ({ ...claw.arms[i], ...a })) });
  }
  return {
    settings: loadSettings(),
    claw,
    counts: { ...DEFAULT_COUNTS, ...(saved.counts ?? {}) },
    seed: typeof saved.seed === 'number' ? saved.seed : 7,
    volume: typeof saved.volume === 'number' ? saved.volume : 0.6,
  };
}

export function saveConfig(c: AppConfig): void {
  saveSettings(c.settings);
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify({ claw: c.claw, counts: c.counts, seed: c.seed, volume: c.volume }));
  } catch {
    // Not persisted — fine.
  }
}

export function cloneConfig(c: AppConfig): AppConfig {
  return { ...c, settings: { ...c.settings }, claw: cloneClawTuning(c.claw), counts: { ...c.counts } };
}
