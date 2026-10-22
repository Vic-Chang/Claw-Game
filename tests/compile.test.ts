import { expect, test } from 'vitest';
import { getMujoco } from '../src/sim/mujoco';
import { buildMjcf } from '../src/sim/mjcf';
import { defaultClawTuning } from '../src/sim/clawConfig';
import { DEFAULT_COUNTS, layoutPrizes } from '../src/sim/prizes';

test('full machine model compiles and runs faster than real time', async () => {
  const mj = await getMujoco();
  const xml = buildMjcf({ claw: defaultClawTuning(), prizes: layoutPrizes(DEFAULT_COUNTS) });
  const m = mj.MjModel.from_xml_string(xml);
  const d = new mj.MjData(m);
  const t0 = performance.now();
  for (let i = 0; i < 1000; i++) mj.mj_step(m, d);
  // The full machine must simulate faster than real time on a laptop-class CPU.
  expect(performance.now() - t0).toBeLessThan(2000);
  expect(m.nbody).toBeGreaterThan(10);
  d.delete();
  m.delete();
});
