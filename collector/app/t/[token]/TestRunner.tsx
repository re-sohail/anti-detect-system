'use client';

import { useEffect, useRef, useState } from 'react';
import { COLLECT_SCHEMA_VERSION, INSTRUMENT_VERSION, type CollectPayload, type Observation } from '@lvd/shared';
import { collectAll, uuidV4 } from '@/lib/instrument-client';

type State =
  | { phase: 'collecting' }
  | { phase: 'submitting'; observations: Record<string, Observation> }
  | { phase: 'done'; observations: Record<string, Observation>; receivedAt: string; visitId: string }
  | { phase: 'failed'; observations?: Record<string, Observation>; message: string };

export function TestRunner(props: { runToken: string; requestGeolocation: boolean; placeStudyToken: boolean }) {
  const [state, setState] = useState<State>({ phase: 'collecting' });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // one visit per page load (React strict mode runs effects twice in dev)
    started.current = true;
    (async () => {
      let observations: Record<string, Observation>;
      try {
        observations = await collectAll(props);
      } catch (e) {
        // Shown as a failure; never left hanging and never retried elsewhere.
        setState({ phase: 'failed', message: `collection error: ${(e as Error).message}` });
        return;
      }
      setState({ phase: 'submitting', observations });
      const payload: CollectPayload = {
        schemaVersion: COLLECT_SCHEMA_VERSION,
        instrumentVersion: INSTRUMENT_VERSION,
        runToken: props.runToken,
        visitId: uuidV4(),
        clientTime: new Date().toISOString(),
        observations,
      };
      try {
        const res = await fetch('/api/v1/collect', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
        setState({ phase: 'done', observations, receivedAt: body.receivedAt, visitId: payload.visitId });
      } catch (e) {
        // Failure is shown as-is; the page never retries through another route (brief §17).
        setState({ phase: 'failed', observations, message: (e as Error).message });
      }
    })();
  }, [props]);

  const observations = 'observations' in state ? state.observations : undefined;

  return (
    <>
      <div className="card" data-testid="status" data-phase={state.phase}>
        {state.phase === 'collecting' && 'Collecting observations…'}
        {state.phase === 'submitting' && 'Submitting to the test service…'}
        {state.phase === 'done' && (
          <span className="ok">
            Submitted. Visit <code>{state.visitId}</code> received at <code>{state.receivedAt}</code>.
          </span>
        )}
        {state.phase === 'failed' && <span className="absent">Submission failed: {state.message}</span>}
      </div>
      {observations && (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Field</th><th>Status</th><th>Value / reason</th></tr></thead>
            <tbody>
              {Object.entries(observations).map(([id, o]) => (
                <tr key={id}>
                  <td><code>{id}</code></td>
                  <td className={o.status === 'ok' ? 'ok' : 'absent'}>{o.status}</td>
                  <td><code>{o.status === 'ok' ? JSON.stringify(o.value) : o.reason + (o.detail ? `: ${o.detail}` : '')}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
