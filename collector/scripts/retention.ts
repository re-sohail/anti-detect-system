// Apply the approved retention policy (plan Phase 0 item 24, Phase 4 item 25).
//   node --experimental-strip-types scripts/retention.ts --mode redact-network --older-than-days 90 --operator "Name" [--apply]
// Without --apply it only reports how many runs are affected.
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createStore } from '../lib/store.ts';

const { values } = parseArgs({
  options: {
    mode: { type: 'string' },
    'older-than-days': { type: 'string' },
    operator: { type: 'string' },
    apply: { type: 'boolean', default: false },
  },
});
const mode = values.mode;
const days = Number(values['older-than-days']);
if ((mode !== 'redact-network' && mode !== 'delete') || !Number.isFinite(days) || days < 1 || !values.operator) {
  console.error('usage: --mode redact-network|delete --older-than-days N --operator NAME [--apply]');
  process.exit(2);
}
const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
const s = createStore(process.env.COLLECTOR_DATA_DIR ?? path.join(process.cwd(), '.data'));
const r = s.applyRetention(mode, cutoff, values.operator, !values.apply);
console.log(JSON.stringify({ mode, cutoff, ...r }, null, 2));
s.close();
