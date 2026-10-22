/**
 * Cabinet geometry of a Taiwanese standard claw machine (標準台), in metres, MuJoCo z-up.
 * +x = player's right, +y = towards the back of the cabinet, z = up from the prize bed.
 */
export const CABINET = {
  /** Interior half width (x) and half depth (y) of the play field. */
  halfW: 0.35,
  halfD: 0.32,
  /** Height of the glass walls above the prize bed. */
  wallH: 0.78,
  /** z of the gantry carriage (pulley point the cable hangs from). */
  gantryZ: 0.7,
  /** Prize chute hole in the front-left corner. */
  hole: { x0: -0.35, x1: -0.16, y0: -0.32, y1: -0.13 },
  /** Default height of the acrylic guard (擋板) around the hole's inner edges. */
  guardH: 0.075,
  /** Adjustable guard height range (m). 0 = no guard. */
  guardRange: [0, 0.15] as [number, number],
  guardT: 0.006,
  /** Gantry travel limits (limit switches), carriage position. */
  travel: { x0: -0.29, x1: 0.29, y0: -0.26, y1: 0.26 },
  /** Home position (above the hole). */
  home: { x: -0.255, y: -0.225 },
  /** Shortest cable length: claw head pulled into the stop tube (管子). */
  ropeMin: 0.075,
  /** Cable length at the normal top stop (upper limit switch). */
  ropeTop: 0.1,
  /** Longest cable the winch can pay out. */
  ropeMax: 0.75,
} as const;

/** Is the point (x, y) above the chute hole? */
export function overHole(x: number, y: number): boolean {
  const h = CABINET.hole;
  return x > h.x0 && x < h.x1 && y > h.y0 && y < h.y1;
}
