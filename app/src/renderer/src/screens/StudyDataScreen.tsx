import { useState } from 'react';
import { call, useAction, useQuery } from '../api';
import { ErrorBox, Section } from '../ui';

export function StudyDataScreen() {
  const inv = useQuery('study.hostInventory', undefined);
  const act = useAction();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      <div className="page-head">
        <h1>Study data</h1>
        <p className="muted">
          Supervisor exports. Ground truth maps run tokens to hosts, guests and conditions. Keep it apart from observations and never give it to the detection team; the analysis toolkit builds the blinded set.
        </p>
      </div>
      <ErrorBox error={inv.error ?? act.error} onClose={() => act.setError(null)} />
      {msg && <div className="notice">{msg}</div>}
      <Section title="Ground truth (supervisor only)" actions={
        <button className="primary" disabled={!!act.busy} onClick={async () => {
          const r = await act.run('gt', () => call('study.exportGroundTruth', undefined));
          if (r) setMsg(`Ground truth for ${r.runs} runs written to ${r.file} (read-only, with .sha256).`);
        }}>Export ground truth…</button>
      }>
        <p className="muted">Run on every host that collected data, then give the files to the supervisor, who merges them with the collector export using <code>analysis/lvd_analysis</code>.</p>
      </Section>
      <Section title="Host inventory (Phase 1 artifact)" actions={
        <button disabled={!!act.busy} onClick={async () => {
          const r = await act.run('inv', () => call('study.saveHostInventory', undefined));
          if (r) setMsg(`Saved ${r.files.join(' and ')}`);
        }}>Save as Markdown + JSON…</button>
      }>
        {inv.data && <pre style={{ maxHeight: 420 }}>{inv.data.markdown}</pre>}
      </Section>
    </>
  );
}
