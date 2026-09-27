// Launch the built app, visit every screen, screenshot it, and fail on renderer errors.
//   npm run build && node scripts/smoke.mjs [outDir]
import { _electron as electron } from 'playwright-core';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const out = process.argv[2] ?? mkdtempSync(path.join(tmpdir(), 'lvd-smoke-'));
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(path.join(tmpdir(), 'lvd-smoke-data-'));

// Editors such as VS Code can leak ELECTRON_RUN_AS_NODE into child shells; it would start Electron as plain Node.
const env = { ...process.env, LVD_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
const errors = [];
const win = await app.firstWindow();
win.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
win.on('pageerror', (e) => errors.push(e.message));
await win.waitForSelector('nav');

const security = await win.evaluate(() => ({
  hasRequire: typeof (globalThis).require !== 'undefined',
  hasProcess: typeof (globalThis).process !== 'undefined',
  bridgeKeys: Object.keys((globalThis).lvd ?? {}),
}));
console.log('renderer isolation:', JSON.stringify(security));

for (const label of ['Host capacity', 'Images', 'Presets', 'Machines', 'Runs & compare', 'Network exits', 'Consent', 'Performance', 'Study data', 'Audit log', 'Settings']) {
  await win.getByRole('button', { name: label, exact: true }).click();
  await win.waitForTimeout(label === 'Host capacity' ? 1500 : 500);
  if (!(await win.locator('.banner').isVisible())) errors.push(`banner missing on ${label}`);
  const file = path.join(out, label.replace(/\W+/g, '-').toLowerCase() + '.png');
  await win.screenshot({ path: file });
  console.log('screenshot', file);
}
await app.close();
if (errors.length) {
  console.error('ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('smoke OK');
