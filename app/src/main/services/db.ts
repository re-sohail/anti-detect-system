import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { AuditEvent, Consent, ImageRecord, NetworkCheck, NetworkExit, Preset } from '@lvd/shared';
import type { GuestRecord, RunRecord } from '@common/ipc';

/**
 * Local control-app store. Holds ground truth (which guest/host produced which run),
 * so it is kept apart from the collector's observation store (brief §8).
 * Presets are versioned (a new row per change); audit and network checks are append-only.
 */
export type Db = ReturnType<typeof openDb>;

export function openDb(dataDir: string) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'app.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS presets (id TEXT NOT NULL, version INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (id, version));
    CREATE TABLE IF NOT EXISTS guests (id TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS network_checks (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS exits (id TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS consents (id TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT, guest_id TEXT NOT NULL, condition_seq INTEGER NOT NULL, at TEXT NOT NULL,
      rss_mb REAL, cpu_pct REAL, disk_mb REAL, power TEXT, thermal TEXT
    );
    CREATE TABLE IF NOT EXISTS guest_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, guest_id TEXT NOT NULL, at TEXT NOT NULL, event TEXT NOT NULL, run_token TEXT, detail_json TEXT
    );
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
      target TEXT, outcome TEXT NOT NULL, detail_json TEXT
    );
  `);
  for (const t of ['audit', 'network_checks', 'presets', 'samples', 'guest_events']) {
    db.exec(`CREATE TRIGGER IF NOT EXISTS ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} is append-only'); END;`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} is append-only'); END;`);
  }

  const parse = <T>(rows: unknown[]): T[] => rows.map((r) => JSON.parse((r as { json: string }).json) as T);

  return {
    raw: db,

    getSetting(key: string): string | null {
      const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
      return r?.value ?? null;
    },
    setSetting(key: string, value: string) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
    },

    listImages: () => parse<ImageRecord>(db.prepare('SELECT json FROM images ORDER BY id').all()),
    getImage(id: string): ImageRecord | null {
      const r = db.prepare('SELECT json FROM images WHERE id = ?').get(id);
      return r ? parse<ImageRecord>([r])[0] : null;
    },
    putImage(img: ImageRecord) {
      db.prepare('INSERT INTO images (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json').run(img.id, JSON.stringify(img));
    },

    /** Latest version of each preset. */
    listPresets: () =>
      parse<Preset>(
        db.prepare('SELECT p.json FROM presets p JOIN (SELECT id, MAX(version) v FROM presets GROUP BY id) m ON p.id = m.id AND p.version = m.v ORDER BY p.id').all(),
      ),
    getPreset(id: string, version?: number): Preset | null {
      const r = version
        ? db.prepare('SELECT json FROM presets WHERE id = ? AND version = ?').get(id, version)
        : db.prepare('SELECT json FROM presets WHERE id = ? ORDER BY version DESC LIMIT 1').get(id);
      return r ? parse<Preset>([r])[0] : null;
    },
    insertPreset(p: Preset) {
      db.prepare('INSERT INTO presets (id, version, json) VALUES (?, ?, ?)').run(p.id, p.version, JSON.stringify(p));
    },

    listGuests: () => parse<GuestRecord>(db.prepare('SELECT json FROM guests ORDER BY id').all()),
    getGuest(id: string): GuestRecord | null {
      const r = db.prepare('SELECT json FROM guests WHERE id = ?').get(id);
      return r ? parse<GuestRecord>([r])[0] : null;
    },
    putGuest(g: GuestRecord) {
      db.prepare('INSERT INTO guests (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json').run(g.id, JSON.stringify(g));
    },
    deleteGuest(id: string) {
      db.prepare('DELETE FROM guests WHERE id = ?').run(id);
    },

    listRuns: () => parse<RunRecord>(db.prepare('SELECT json FROM runs ORDER BY created_at DESC').all()),
    getRun(id: string): RunRecord | null {
      const r = db.prepare('SELECT json FROM runs WHERE id = ?').get(id);
      return r ? parse<RunRecord>([r])[0] : null;
    },
    putRun(r: RunRecord) {
      db.prepare('INSERT INTO runs (id, created_at, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json').run(r.id, r.createdAt, JSON.stringify(r));
    },

    addNetworkCheck(c: NetworkCheck) {
      db.prepare('INSERT INTO network_checks (run_id, json) VALUES (?, ?)').run(c.runId, JSON.stringify(c));
    },
    networkChecks: (runId: string) => parse<NetworkCheck>(db.prepare('SELECT json FROM network_checks WHERE run_id = ? ORDER BY id').all(runId)),

    listExits: () => parse<NetworkExit>(db.prepare('SELECT json FROM exits ORDER BY id').all()),
    getExit(id: string): NetworkExit | null {
      const r = db.prepare('SELECT json FROM exits WHERE id = ?').get(id);
      return r ? parse<NetworkExit>([r])[0] : null;
    },
    putExit(e: NetworkExit) {
      db.prepare('INSERT INTO exits (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json').run(e.id, JSON.stringify(e));
    },

    listConsents: () => parse<Consent>(db.prepare('SELECT json FROM consents ORDER BY id').all()),
    getConsent(id: string): Consent | null {
      const r = db.prepare('SELECT json FROM consents WHERE id = ?').get(id);
      return r ? parse<Consent>([r])[0] : null;
    },
    putConsent(c: Consent) {
      db.prepare('INSERT INTO consents (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json').run(c.id, JSON.stringify(c));
    },

    addSample(x: { guestId: string; conditionSeq: number; rssMb: number | null; cpuPct: number | null; diskMb: number | null; power: string | null; thermal: string | null }) {
      db.prepare('INSERT INTO samples (guest_id, condition_seq, at, rss_mb, cpu_pct, disk_mb, power, thermal) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        x.guestId, x.conditionSeq, new Date().toISOString(), x.rssMb, x.cpuPct, x.diskMb, x.power, x.thermal,
      );
    },
    samples(guestId?: string) {
      return (guestId
        ? db.prepare('SELECT * FROM samples WHERE guest_id = ? ORDER BY id').all(guestId)
        : db.prepare('SELECT * FROM samples ORDER BY id').all()) as Array<{
        guest_id: string; condition_seq: number; at: string; rss_mb: number | null; cpu_pct: number | null; disk_mb: number | null; power: string | null; thermal: string | null;
      }>;
    },

    addGuestEvent(guestId: string, event: string, runToken: string | null, detail?: unknown) {
      db.prepare('INSERT INTO guest_events (guest_id, at, event, run_token, detail_json) VALUES (?, ?, ?, ?, ?)').run(
        guestId, new Date().toISOString(), event, runToken, detail === undefined ? null : JSON.stringify(detail),
      );
    },
    guestEvents(guestId?: string) {
      const rows = (guestId
        ? db.prepare('SELECT * FROM guest_events WHERE guest_id = ? ORDER BY id').all(guestId)
        : db.prepare('SELECT * FROM guest_events ORDER BY id').all()) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        guestId: r.guest_id as string, at: r.at as string, event: r.event as string, runToken: (r.run_token as string) ?? null,
        detail: r.detail_json ? JSON.parse(r.detail_json as string) : null,
      }));
    },

    audit(e: Omit<AuditEvent, 'id' | 'at'>) {
      db.prepare('INSERT INTO audit (at, actor, action, target, outcome, detail_json) VALUES (?, ?, ?, ?, ?, ?)').run(
        new Date().toISOString(), e.actor, e.action, e.target, e.outcome, e.detail === undefined ? null : JSON.stringify(e.detail),
      );
    },
    listAudit(limit: number, target?: string): AuditEvent[] {
      const rows = (target
        ? db.prepare('SELECT * FROM audit WHERE target = ? ORDER BY id DESC LIMIT ?').all(target, limit)
        : db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?').all(limit)) as Record<string, unknown>[];
      return rows.map((r) => ({
        id: r.id as number, at: r.at as string, actor: r.actor as string, action: r.action as string,
        target: (r.target as string) ?? null, outcome: r.outcome as 'ok' | 'error',
        detail: r.detail_json ? JSON.parse(r.detail_json as string) : undefined,
      }));
    },

    close: () => db.close(),
  };
}
