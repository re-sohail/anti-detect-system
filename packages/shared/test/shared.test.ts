import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CollectPayload, PresetInput, diffObjects, canonicalJson, INSTRUMENT_FIELDS } from '../src/index.ts';

test('instrument field ids are unique', () => {
  const ids = INSTRUMENT_FIELDS.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('collect payload rejects unknown reason codes', () => {
  const base = {
    schemaVersion: 1, instrumentVersion: '1.0.0', runToken: 'abcdefghijklmnop',
    visitId: '8d7f0a0e-6f6b-4c1a-9e0b-3f1f0b7a1c2d', clientTime: new Date().toISOString(),
  };
  assert.ok(CollectPayload.safeParse({ ...base, observations: { a: { status: 'absent', reason: 'timeout' } } }).success);
  assert.ok(!CollectPayload.safeParse({ ...base, observations: { a: { status: 'absent', reason: 'guessed' } } }).success);
});

test('preset rejects invalid timezone and tiny memory', () => {
  const p = {
    name: 'Linux desktop study A',
    hostConstraint: { arch: ['arm64'], os: ['darwin'], minHostRamMb: 8192, backend: 'qemu' },
    guest: { os: 'linux', arch: 'aarch64', imageId: 'img_1' },
    resources: { vcpus: 2, memoryMb: 2048, diskGb: 20 },
    display: { width: 1280, height: 800 },
    regional: { timeZone: 'Europe/London', locale: 'en-GB' },
    network: { routeId: 'default-nat' },
    expectedBootState: 'desktop-login',
  };
  assert.ok(PresetInput.safeParse(p).success);
  assert.ok(!PresetInput.safeParse({ ...p, regional: { timeZone: 'not a tz', locale: 'en-GB' } }).success);
  assert.ok(!PresetInput.safeParse({ ...p, resources: { ...p.resources, memoryMb: 16 } }).success);
});

test('diff reports leaf changes only', () => {
  const d = diffObjects({ a: 1, b: { c: 2, d: 3 } }, { a: 1, b: { c: 5, d: 3 }, e: 1 });
  assert.deepEqual(d.map((x) => x.path), ['b.c', 'e']);
});

test('canonical json is key-order independent', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 1, c: 2 } }), canonicalJson({ a: { c: 2, d: 1 }, b: 1 }));
});
