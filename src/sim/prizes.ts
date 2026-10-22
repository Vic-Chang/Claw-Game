import { CABINET, overHole } from './cabinet';

export type PrizeKind = 'cookieBox' | 'tissueBox' | 'bottle' | 'plushSmall' | 'plushMedium';

export interface PrizeKindSpec {
  label: string;
  /** Total mass in kg. */
  mass: number;
  /** Bounding half extents for layout (x, y, z). */
  half: [number, number, number];
}

export const PRIZE_KINDS: Record<PrizeKind, PrizeKindSpec> = {
  cookieBox: { label: '餅乾盒', mass: 0.11, half: [0.05, 0.034, 0.024] },
  tissueBox: { label: '面紙盒', mass: 0.17, half: [0.075, 0.045, 0.032] },
  bottle: { label: '飲料瓶', mass: 0.26, half: [0.03, 0.03, 0.07] },
  plushSmall: { label: '小娃娃', mass: 0.09, half: [0.045, 0.04, 0.05] },
  plushMedium: { label: '中娃娃', mass: 0.2, half: [0.06, 0.05, 0.065] },
};

export interface PrizePlacement {
  kind: PrizeKind;
  pos: [number, number, number];
  /** Rotation about z, radians. */
  yaw: number;
  /** Optional full orientation quaternion (w, x, y, z); overrides yaw. Used when rebuilding. */
  quat?: [number, number, number, number];
  color: string;
}

export type PrizeCounts = Record<PrizeKind, number>;

export const DEFAULT_COUNTS: PrizeCounts = {
  cookieBox: 8,
  tissueBox: 4,
  bottle: 1,
  plushSmall: 3,
  plushMedium: 2,
};

const BOX_COLORS = ['#7b5bd6', '#5b7fd6', '#d65bb4', '#e0a030', '#3fae7a'];
const PLUSH_COLORS = ['#f2a7c3', '#9fd36b', '#f5d76e', '#8fc7f0', '#c9a27e', '#ffffff'];

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Lays prizes out on the bed like an operator would: boxes in neat rows towards the back,
 * plush and bottles scattered, nothing over the chute. Positions are dropped from a small
 * height and let settle physically.
 */
export function layoutPrizes(counts: PrizeCounts, seed = 7): PrizePlacement[] {
  const rand = rng(seed);
  const out: PrizePlacement[] = [];
  const margin = 0.012;
  const cells: Array<{ x: number; y: number; level: number }> = [];

  // Box rows at the back and right side, stacked in layers.
  const boxKinds: PrizeKind[] = [];
  for (let i = 0; i < counts.tissueBox; i++) boxKinds.push('tissueBox');
  for (let i = 0; i < counts.cookieBox; i++) boxKinds.push('cookieBox');
  let cx = -CABINET.halfW + 0.09;
  let cy = CABINET.halfD - 0.06;
  let level = 0;
  for (const kind of boxKinds) {
    const h = PRIZE_KINDS[kind].half;
    if (cx + h[0] > CABINET.halfW - margin) {
      cx = -CABINET.halfW + 0.09;
      cy -= 0.1;
      if (cy < -0.02) {
        cy = CABINET.halfD - 0.06;
        level++;
      }
    }
    const z = h[2] + level * 0.07 + 0.005;
    out.push({
      kind,
      pos: [cx + h[0] - 0.05, cy, z],
      yaw: (rand() - 0.5) * 0.12,
      color: BOX_COLORS[Math.floor(rand() * BOX_COLORS.length)],
    });
    cells.push({ x: cx, y: cy, level });
    cx += h[0] * 2 + margin;
  }

  // Loose prizes in the free middle/front area.
  const loose: PrizeKind[] = [];
  for (let i = 0; i < counts.plushMedium; i++) loose.push('plushMedium');
  for (let i = 0; i < counts.plushSmall; i++) loose.push('plushSmall');
  for (let i = 0; i < counts.bottle; i++) loose.push('bottle');
  const taken: Array<[number, number, number]> = [];
  for (const kind of loose) {
    const h = PRIZE_KINDS[kind].half;
    let x = 0;
    let y = 0;
    for (let tries = 0; tries < 60; tries++) {
      x = -0.08 + rand() * (CABINET.halfW - 0.08 - h[0] + 0.08);
      y = -CABINET.halfD + 0.08 + rand() * 0.2;
      const clear = !overHole(x, y) && taken.every(([tx, ty, r]) => Math.hypot(tx - x, ty - y) > r + Math.max(h[0], h[1]));
      if (clear) break;
    }
    taken.push([x, y, Math.max(h[0], h[1])]);
    const isPlush = kind.startsWith('plush');
    out.push({
      kind,
      pos: [x, y, kind === 'bottle' ? 0.035 : h[2] + 0.01],
      yaw: rand() * Math.PI * 2,
      // Bottles lie on their side.
      quat: kind === 'bottle' ? [Math.SQRT1_2, Math.SQRT1_2, 0, 0] : undefined,
      color: isPlush ? PLUSH_COLORS[Math.floor(rand() * PLUSH_COLORS.length)] : '#e8f4ff',
    });
  }
  return out;
}
