import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../lib/store.ts';
import type { CollectPayload } from '@lvd/shared';

const dir = () => mkdtempSync(path.join(tmpdir(), 'lvd-collector-'));
const TOKEN = 'tok_abcdefghijklmnop';
const payload = (over: Partial<CollectPayload> = {}): CollectPayload => ({
  schemaVersion: 1, instrumentVersion: '1.0.0', runToken: TOKEN,
  visitId: '8d7f0a0e-6f6b-4c1a-9e0b-3f1f0b7a1c2d', clientTime: new Date().toISOString(),
  observations: { 'intl.timeZone': { status: 'ok', value: 'Europe/London' } }, ...over,
});
const peer = { ip: '203.0.113.5', source: 'test' };

test('visits require no overwrite: duplicate is idempotent, different payload conflicts', () => {
  const s = createStore(dir());
  s.registerRun({ runToken: TOKEN, runId: 'run_1', routeId: 'default-nat' });
  const p = payload();
  assert.equal(s.recordVisit(p, peer, {}).status, 'created');
  assert.equal(s.recordVisit(structuredClone(p), peer, {}).status, 'duplicate');
  const changed = { ...p, observations: { 'intl.timeZone': { status: 'ok' as const, value: 'UTC' } } };
  assert.equal(s.recordVisit(changed, peer, {}).status, 'conflict');
  s.close();
});

test('evidence tables reject UPDATE and DELETE', () => {
  const d = dir();
  const s = createStore(d);
  s.registerRun({ runToken: TOKEN, runId: 'run_1', routeId: 'default-nat' });
  s.recordVisit(payload(), peer, {});
  s.close();
  const raw = new DatabaseSync(path.join(d, 'collector.db'));
  assert.throws(() => raw.exec("UPDATE visits SET peer_ip = '1.1.1.1'"), /append-only/);
  assert.throws(() => raw.exec('DELETE FROM visits'), /append-only/);
  raw.close();
});

test('run token cannot be re-registered to a different run', () => {
  const s = createStore(dir());
  assert.equal(s.registerRun({ runToken: TOKEN, runId: 'run_1', routeId: 'r' }).status, 'created');
  assert.equal(s.registerRun({ runToken: TOKEN, runId: 'run_1', routeId: 'r' }).status, 'exists');
  assert.equal(s.registerRun({ runToken: TOKEN, runId: 'run_2', routeId: 'r' }).status, 'conflict');
  s.close();
});

test('clock offset is recorded', () => {
  const s = createStore(dir());
  s.registerRun({ runToken: TOKEN, runId: 'run_1', routeId: 'r' });
  s.recordVisit(payload({ clientTime: new Date(Date.now() - 5000).toISOString() }), peer, {});
  const v = s.runDetail(TOKEN)!.visits[0] as unknown as { clock_offset_ms: number };
  assert.ok(v.clock_offset_ms >= 4900 && v.clock_offset_ms < 7000);
  s.close();
});

test('annotations append without changing the observation', () => {
  const s = createStore(dir());
  s.registerRun({ runToken: TOKEN, runId: 'run_1', routeId: 'r' });
  s.recordVisit(payload(), peer, {});
  const before = JSON.stringify(s.exportAll().visits);
  assert.ok(s.addAnnotation(1, 'supervisor', 'timezone set after page load; see deviation D-3'));
  assert.equal(s.addAnnotation(999, 'x', 'y'), null);
  const after = s.exportAll();
  assert.equal(JSON.stringify(after.visits), before);
  assert.equal(after.annotations.length, 1);
  s.close();
});

test('retention: dry run changes nothing; redact removes network identifiers and is logged; triggers restored', () => {
  const d = dir();
  const s = createStore(d);
  s.registerRun({ runToken: TOKEN, runId: 'run_1', routeId: 'r' });
  s.recordVisit(payload(), peer, { headers: { 'x-forwarded-for': '203.0.113.5', 'user-agent': 'x' }, peer });
  const future = new Date(Date.now() + 60_000).toISOString();
  assert.equal(s.applyRetention('redact-network', future, 'tester', true).dryRun, true);
  assert.equal((s.exportAll().visits[0] as { peer_ip: string }).peer_ip, '203.0.113.5');
  const r = s.applyRetention('redact-network', future, 'tester', false);
  assert.equal(r.runs, 1);
  const v = s.exportAll().visits[0] as { peer_ip: string | null; server_json: { headers: Record<string, string> } };
  assert.equal(v.peer_ip, null);
  assert.equal(v.server_json.headers['x-forwarded-for'], undefined);
  assert.equal(v.server_json.headers['user-agent'], 'x');
  assert.equal(s.exportAll().retentionLog.length, 1);
  s.close();
  const raw = new DatabaseSync(path.join(d, 'collector.db'));
  assert.throws(() => raw.exec('DELETE FROM visits'), /append-only/);
  raw.close();
});

test('retention: delete removes the expired runs completely', () => {
  const s = createStore(dir());
  s.registerRun({ runToken: TOKEN, runId: 'run_1', routeId: 'r' });
  s.recordVisit(payload(), peer, {});
  s.applyRetention('delete', new Date(Date.now() + 60_000).toISOString(), 'tester', false);
  const e = s.exportAll();
  assert.equal(e.runs.length + e.visits.length, 0);
  s.close();
});
