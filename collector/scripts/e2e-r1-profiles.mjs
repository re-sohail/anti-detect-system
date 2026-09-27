// R1 storage-isolation check at the browser-profile level (treatment T1 baseline).
// Two separate Chrome user-data dirs: A places a benign study token, both restart,
// A must retain it and B must never have seen it. Requires the collector running.
//   COLLECTOR_URL=http://localhost:4100 node scripts/e2e-r1-profiles.mjs
import { chromium } from 'playwright-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const BASE = process.env.COLLECTOR_URL ?? 'http://localhost:4100';
const ADMIN = process.env.COLLECTOR_ADMIN_KEY ?? 'dev-admin-key';
const CHANNEL = process.env.CHROME_CHANNEL ?? 'chrome';

async function register() {
  const runToken = 'tok_' + randomBytes(10).toString('hex');
  const res = await fetch(`${BASE}/api/v1/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN },
    body: JSON.stringify({ runToken, runId: 'e2e_' + Date.now(), routeId: 'default-nat' }),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  return runToken;
}

async function visit(profileDir, runToken, query = '') {
  const ctx = await chromium.launchPersistentContext(profileDir, { channel: CHANNEL, headless: true });
  try {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/t/${runToken}${query}`);
    const status = page.getByTestId('status');
    await status.and(page.locator('[data-phase="done"], [data-phase="failed"]')).waitFor({ timeout: 30000 });
    const phase = await status.getAttribute('data-phase');
    if (phase !== 'done') throw new Error('visit failed: ' + (await status.textContent()));
  } finally {
    await ctx.close(); // closing the context = browser restart for the next visit
  }
}

async function detail(runToken) {
  const res = await fetch(`${BASE}/api/v1/runs/${runToken}`, { headers: { 'x-admin-key': ADMIN } });
  return res.json();
}

const tmp = mkdtempSync(path.join(tmpdir(), 'lvd-r1-'));
const [profileA, profileB] = [path.join(tmp, 'A'), path.join(tmp, 'B')];
let failed = false;
try {
  const tokA = await register();
  const tokB = await register();
  await visit(profileA, tokA, '?place=1');
  await visit(profileB, tokB);
  // restart both
  await visit(profileA, tokA);
  await visit(profileB, tokB);

  const [a, b] = [await detail(tokA), await detail(tokB)];
  const tokens = (d) => d.visits.map((v) => v.payload_json.observations['storage.testToken'].value);
  const [ta, tb] = [tokens(a), tokens(b)];
  const placed = ta[0].placedToken;
  const checks = [
    ['A placed a token on first visit', typeof placed === 'string'],
    ['A retained the same token after restart', ta[1].existingToken === placed],
    ['B never had a token', tb.every((t) => t.existingToken === null && t.placedToken === null)],
    ['every visit has a server-observed peer', [...a.visits, ...b.visits].every((v) => v.peer_ip && v.peer_source === 'socket')],
    ['disabled fields recorded as disabled-by-protocol', a.visits[0].payload_json.observations['render.canvas2d'].reason === 'disabled-by-protocol'],
    ['geolocation not requested is recorded, not guessed', a.visits[0].payload_json.observations['geo.position'].reason === 'permission-not-requested'],
  ];
  for (const [name, pass] of checks) {
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
    if (!pass) failed = true;
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
