/* Roda tudo: `node test/run.mjs` a partir de scripts/. */
import { run } from './harness.mjs';
import './decimal.test.mjs';
import './pricing.test.mjs';
import './annex.test.mjs';
import './benchmark.test.mjs';
await run();
