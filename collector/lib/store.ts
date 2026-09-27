import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson, type CollectPayload, type GuestReport } from '@lvd/shared';

/**
 * Collector store. The collector never learns host or guest identity: it only knows
 * opaque run tokens registered by the control app. Ground truth lives elsewhere (brief §8).
 *
 * Observations are immutable: SQLite triggers abort any UPDATE or DELETE on evidence tables.
 * Corrections must be appended as annotations (brief §17).
 */
const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS runs (
  run_token     TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL,
  route_id      TEXT NOT NULL,
  expected_ip   TEXT,
  registered_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS visits (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  run_token          TEXT NOT NULL REFERENCES runs(run_token),
  visit_id           TEXT NOT NULL,
  received_at        TEXT NOT NULL,
  schema_version     INTEGER NOT NULL,
  instrument_version TEXT NOT NULL,
  client_time        TEXT NOT NULL,
  clock_offset_ms    INTEGER NOT NULL,
  peer_ip            TEXT,
  peer_source        TEXT NOT NULL,
  server_json        TEXT NOT NULL,
  payload_json       TEXT NOT NULL,
  payload_sha256     TEXT NOT NULL,
  UNIQUE (run_token, visit_id)
);

CREATE TABLE IF NOT EXISTS guest_reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_token   TEXT NOT NULL REFERENCES runs(run_token),
  received_at TEXT NOT NULL,
  peer_ip     TEXT,
  report_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS echo_checks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_token   TEXT,
  received_at TEXT NOT NULL,
  peer_ip     TEXT,
  peer_source TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS retention_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  action      TEXT NOT NULL,
  cutoff      TEXT NOT NULL,
  rows        INTEGER NOT NULL,
  operator    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS annotations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_row   INTEGER NOT NULL REFERENCES visits(id),
  created_at  TEXT NOT NULL,
  author      TEXT NOT NULL,
  note        TEXT NOT NULL
);
`;

const IMMUTABLE_TABLES = ['visits', 'guest_reports', 'echo_checks', 'annotations', 'runs'];

export interface PeerInfo {
  ip: string | null;
  source: string;
}

export type Store = ReturnType<typeof createStore>;

export function createStore(dataDir: string) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'collector.db'));
  db.exec(SCHEMA);
  const installTriggers = () => {
    for (const t of IMMUTABLE_TABLES) {
      db.exec(`CREATE TRIGGER IF NOT EXISTS ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} is append-only'); END;`);
      db.exec(`CREATE TRIGGER IF NOT EXISTS ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} is append-only'); END;`);
    }
  };
  installTriggers();

  const getRun = db.prepare('SELECT run_token, run_id, route_id, expected_ip, registered_at FROM runs WHERE run_token = ?');

  return {
    registerRun(input: { runToken: string; runId: string; routeId: string; expectedIp?: string | null }) {
      const existing = getRun.get(input.runToken) as Record<string, unknown> | undefined;
      if (existing) {
        if (existing.run_id !== input.runId) return { status: 'conflict' as const };
        return { status: 'exists' as const, run: existing };
      }
      const registeredAt = new Date().toISOString();
      db.prepare('INSERT INTO runs (run_token, run_id, route_id, expected_ip, registered_at) VALUES (?, ?, ?, ?, ?)').run(
        input.runToken, input.runId, input.routeId, input.expectedIp ?? null, registeredAt,
      );
      return { status: 'created' as const, run: getRun.get(input.runToken) };
    },

    isRegistered(runToken: string): boolean {
      return getRun.get(runToken) !== undefined;
    },

    recordVisit(payload: CollectPayload, peer: PeerInfo, serverInfo: Record<string, unknown>) {
      const payloadJson = canonicalJson(payload);
      const sha = createHash('sha256').update(payloadJson).digest('hex');
      const prior = db
        .prepare('SELECT received_at, payload_sha256 FROM visits WHERE run_token = ? AND visit_id = ?')
        .get(payload.runToken, payload.visitId) as { received_at: string; payload_sha256: string } | undefined;
      if (prior) {
        // Idempotent resubmission is fine; a different payload for the same visit is refused, never overwritten.
        return prior.payload_sha256 === sha
          ? { status: 'duplicate' as const, receivedAt: prior.received_at }
          : { status: 'conflict' as const };
      }
      const receivedAt = new Date();
      const offset = receivedAt.getTime() - new Date(payload.clientTime).getTime();
      db.prepare(
        `INSERT INTO visits (run_token, visit_id, received_at, schema_version, instrument_version, client_time,
           clock_offset_ms, peer_ip, peer_source, server_json, payload_json, payload_sha256)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        payload.runToken, payload.visitId, receivedAt.toISOString(), payload.schemaVersion, payload.instrumentVersion,
        payload.clientTime, offset, peer.ip, peer.source, canonicalJson(serverInfo), payloadJson, sha,
      );
      return { status: 'created' as const, receivedAt: receivedAt.toISOString(), payloadSha256: sha };
    },

    recordGuestReport(report: GuestReport, peer: PeerInfo) {
      const receivedAt = new Date().toISOString();
      db.prepare('INSERT INTO guest_reports (run_token, received_at, peer_ip, report_json) VALUES (?, ?, ?, ?)').run(
        report.runToken, receivedAt, peer.ip, canonicalJson(report),
      );
      return { receivedAt };
    },

    recordEcho(runToken: string | null, peer: PeerInfo) {
      const receivedAt = new Date().toISOString();
      db.prepare('INSERT INTO echo_checks (run_token, received_at, peer_ip, peer_source) VALUES (?, ?, ?, ?)').run(
        runToken, receivedAt, peer.ip, peer.source,
      );
      return { receivedAt };
    },

    /** Corrections are appended, never written over the observation (brief §17). */
    addAnnotation(visitRow: number, author: string, note: string) {
      const exists = db.prepare('SELECT id FROM visits WHERE id = ?').get(visitRow);
      if (!exists) return null;
      const createdAt = new Date().toISOString();
      const r = db.prepare('INSERT INTO annotations (visit_row, created_at, author, note) VALUES (?, ?, ?, ?)').run(visitRow, createdAt, author, note);
      return { id: Number(r.lastInsertRowid), visitRow, createdAt, author, note };
    },

    /** Full evidence export for the supervisor (raw, NOT blinded). */
    exportAll() {
      const parseCols = (rows: Record<string, unknown>[], cols: string[]) =>
        rows.map((r) => {
          const o: Record<string, unknown> = { ...r };
          for (const c of cols) if (typeof o[c] === 'string') o[c] = JSON.parse(o[c] as string);
          return o;
        });
      return {
        exportedAt: new Date().toISOString(),
        runs: db.prepare('SELECT * FROM runs ORDER BY registered_at').all(),
        visits: parseCols(db.prepare('SELECT * FROM visits ORDER BY id').all() as Record<string, unknown>[], ['server_json', 'payload_json']),
        guestReports: parseCols(db.prepare('SELECT * FROM guest_reports ORDER BY id').all() as Record<string, unknown>[], ['report_json']),
        echoChecks: db.prepare('SELECT * FROM echo_checks ORDER BY id').all(),
        annotations: db.prepare('SELECT * FROM annotations ORDER BY id').all(),
        retentionLog: db.prepare('SELECT * FROM retention_log ORDER BY id').all(),
      };
    },

    /**
     * Retention (plan Phase 4 item 25). The ONLY code path allowed to remove or redact evidence:
     * it lifts the append-only triggers inside one transaction, applies the approved policy to rows
     * older than the cutoff, logs what it did, and restores the triggers.
     * mode 'redact-network' nulls peer IPs and drops forwarding headers; 'delete' removes the runs' evidence.
     */
    applyRetention(mode: 'redact-network' | 'delete', cutoffIso: string, operator: string, dryRun: boolean) {
      const tokens = (db.prepare('SELECT run_token FROM runs WHERE registered_at < ?').all(cutoffIso) as { run_token: string }[]).map((r) => r.run_token);
      if (dryRun || tokens.length === 0) return { runs: tokens.length, rows: 0, dryRun: true };
      const ph = tokens.map(() => '?').join(',');
      let rows = 0;
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const t of IMMUTABLE_TABLES) {
          db.exec(`DROP TRIGGER IF EXISTS ${t}_no_update`);
          db.exec(`DROP TRIGGER IF EXISTS ${t}_no_delete`);
        }
        if (mode === 'redact-network') {
          const visits = db.prepare(`SELECT id, server_json FROM visits WHERE run_token IN (${ph})`).all(...tokens) as { id: number; server_json: string }[];
          for (const v of visits) {
            const sj = JSON.parse(v.server_json) as { headers?: Record<string, string>; peer?: { ip: string | null } };
            for (const h of ['x-forwarded-for', 'x-real-ip', 'forwarded', 'x-lvd-socket']) delete sj.headers?.[h];
            if (sj.peer) sj.peer.ip = null;
            db.prepare('UPDATE visits SET peer_ip = NULL, server_json = ? WHERE id = ?').run(canonicalJson(sj), v.id);
            rows++;
          }
          rows += Number(db.prepare(`UPDATE guest_reports SET peer_ip = NULL WHERE run_token IN (${ph})`).run(...tokens).changes);
          rows += Number(db.prepare(`UPDATE echo_checks SET peer_ip = NULL WHERE run_token IN (${ph})`).run(...tokens).changes);
        } else {
          rows += Number(db.prepare(`DELETE FROM annotations WHERE visit_row IN (SELECT id FROM visits WHERE run_token IN (${ph}))`).run(...tokens).changes);
          for (const t of ['visits', 'guest_reports', 'echo_checks']) {
            rows += Number(db.prepare(`DELETE FROM ${t} WHERE run_token IN (${ph})`).run(...tokens).changes);
          }
          rows += Number(db.prepare(`DELETE FROM runs WHERE run_token IN (${ph})`).run(...tokens).changes);
        }
        db.prepare('INSERT INTO retention_log (at, action, cutoff, rows, operator) VALUES (?, ?, ?, ?, ?)').run(
          new Date().toISOString(), mode, cutoffIso, rows, operator,
        );
        installTriggers();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        installTriggers();
        throw e;
      }
      return { runs: tokens.length, rows, dryRun: false };
    },

    runDetail(runToken: string) {
      const run = getRun.get(runToken);
      if (!run) return null;
      const visits = (db.prepare('SELECT * FROM visits WHERE run_token = ? ORDER BY id').all(runToken) as Record<string, unknown>[]).map(
        (v) => ({ ...v, server_json: JSON.parse(v.server_json as string), payload_json: JSON.parse(v.payload_json as string) }),
      );
      const guestReports = (db.prepare('SELECT * FROM guest_reports WHERE run_token = ? ORDER BY id').all(runToken) as Record<string, unknown>[]).map(
        (r) => ({ ...r, report_json: JSON.parse(r.report_json as string) }),
      );
      const echoChecks = db.prepare('SELECT * FROM echo_checks WHERE run_token = ? ORDER BY id').all(runToken);
      return { run, visits, guestReports, echoChecks };
    },

    close() {
      db.close();
    },
  };
}
