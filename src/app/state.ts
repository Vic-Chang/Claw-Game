import { type Settings, loadSettings, saveSettings } from '../machine/settings';
import { CABINET } from '../sim/cabinet';
import { type ClawTuning, cloneClawTuning, defaultClawTuning, spreadRange } from '../sim/clawConfig';
import { DEFAULT_COUNTS, type PrizeCounts } from '../sim/prizes';

/** Operator-side configuration that lives on the main thread and is mirrored to the worker. */
export interface AppConfig {
  settings: Settings;
  claw: ClawTuning;
  counts: PrizeCounts;
  seed: number;
  volume: number;
  /** Chute guard (出貨口擋板) height, cm. */
  guardCm: number;
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
    const sc = saved.claw;
    if (sc.size) claw.size = sc.size;
    if (sc.sleeve) claw.sleeve = sc.sleeve;
    if (typeof sc.customFriction === 'number') claw.customFriction = sc.customFriction;
    // Only the spread is per arm (older saves also had per-arm fins; those are dropped).
    const [lo, hi] = spreadRange(claw.size);
    sc.arms.forEach((a, i) => {
      if (typeof a?.spreadCm === 'number') claw.arms[i].spreadCm = Math.max(lo, Math.min(hi, a.spreadCm));
    });
    if (sc.antiSwing) claw.antiSwing = { ...claw.antiSwing, ...sc.antiSwing };
  }
  return {
    settings: loadSettings(),
    claw,
    counts: { ...DEFAULT_COUNTS, ...(saved.counts ?? {}) },
    seed: typeof saved.seed === 'number' ? saved.seed : 7,
    volume: typeof saved.volume === 'number' ? saved.volume : 0.6,
    guardCm: typeof saved.guardCm === 'number' ? saved.guardCm : CABINET.guardH * 100,
  };
}

export function saveConfig(c: AppConfig): void {
  saveSettings(c.settings);
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify({ claw: c.claw, counts: c.counts, seed: c.seed, volume: c.volume, guardCm: c.guardCm }));
  } catch {
    // Not persisted — fine.
  }
}

export function cloneConfig(c: AppConfig): AppConfig {
  return { ...c, settings: { ...c.settings }, claw: cloneClawTuning(c.claw), counts: { ...c.counts } };
}
