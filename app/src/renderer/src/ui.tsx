import type { ReactNode } from 'react';
import type { AppErrorShape } from '@lvd/shared';

export function ErrorBox({ error, onClose }: { error: AppErrorShape | null; onClose?: () => void }) {
  if (!error) return null;
  const failed = (error.details as { failed?: { label: string; detail: string }[] } | undefined)?.failed;
  const logTail = (error.details as { logTail?: string } | undefined)?.logTail;
  return (
    <div className="error" role="alert">
      <div className="row between">
        <strong>
          <code>{error.code}</code> {error.message}
        </strong>
        {onClose && <button className="link" onClick={onClose}>Dismiss</button>}
      </div>
      {failed && (
        <ul>
          {failed.map((f) => (
            <li key={f.label}>{f.label}: {f.detail}</li>
          ))}
        </ul>
      )}
      {logTail && <pre>{logTail}</pre>}
    </div>
  );
}

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <div className="row between section-head">
        <h2>{title}</h2>
        <div className="row gap">{actions}</div>
      </div>
      {children}
    </section>
  );
}

export function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'muted' | 'info'; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function Unknown({ value }: { value: string | null | undefined }) {
  return value === null || value === undefined ? <span className="muted">unknown</span> : <>{value}</>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export const fmtTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');
export const fmtMb = (mb: number | null | undefined) =>
  mb === null || mb === undefined ? 'unknown' : mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
