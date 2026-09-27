import { AppError } from '../errors';

/**
 * Talks ONLY to the configured university collector. There is deliberately no fallback
 * URL or alternative route: an outage is recorded, never silently retried elsewhere (brief §17).
 */
export class CollectorClient {
  constructor(private baseUrl: string, private adminKey: string | null) {}

  private async call<T>(pathname: string, init: RequestInit = {}, admin = false): Promise<T> {
    const url = new URL(pathname, this.baseUrl).toString();
    const headers = new Headers(init.headers);
    if (admin) {
      if (!this.adminKey) throw new AppError('invalid-input', 'Collector admin key is not configured (Settings)');
      headers.set('x-admin-key', this.adminKey);
    }
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(8000), redirect: 'error' });
    } catch (e) {
      throw new AppError('collector-unreachable', `Collector unreachable at ${this.baseUrl}: ${(e as Error).message}`);
    }
    const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: { code: string; message: string } } | null;
    if (!res.ok) {
      throw new AppError(res.status === 404 ? 'not-found' : 'collector-unreachable', `Collector ${res.status}: ${body?.error?.message ?? res.statusText}`);
    }
    return body as T;
  }

  registerRun(input: { runToken: string; runId: string; routeId: string; expectedIp?: string | null }) {
    return this.call('/api/v1/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }, true);
  }

  echo(runToken?: string) {
    const q = runToken ? `?runToken=${encodeURIComponent(runToken)}` : '';
    return this.call<{ observedIp: string | null; peerSource: string; serverTime: string; instrumentVersion: string }>(`/api/v1/echo${q}`);
  }

  runDetail(runToken: string) {
    return this.call<CollectorRunDetail>(`/api/v1/runs/${encodeURIComponent(runToken)}`, {}, true);
  }
}

export interface CollectorVisit {
  visit_id: string;
  received_at: string;
  instrument_version: string;
  clock_offset_ms: number;
  peer_ip: string | null;
  peer_source: string;
  server_json: { headers: Record<string, string> };
  payload_json: { observations: Record<string, { status: 'ok'; value: unknown } | { status: 'absent'; reason: string; detail?: string }> };
}

export interface CollectorRunDetail {
  run: Record<string, unknown>;
  visits: CollectorVisit[];
  guestReports: { received_at: string; peer_ip: string | null; report_json: Record<string, unknown> }[];
  echoChecks: unknown[];
}
