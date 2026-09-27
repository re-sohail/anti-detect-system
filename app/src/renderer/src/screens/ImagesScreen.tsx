import { useState } from 'react';
import type { ImageMeta } from '@common/ipc';
import { call, useAction, useQuery } from '../api';
import { ErrorBox, Field, Pill, Section, fmtMb, fmtTime } from '../ui';

const EMPTY: ImageMeta = { name: '', version: '', origin: '', guestOs: 'linux', guestArch: 'aarch64', licenseNotes: '', expectedSha256: '', provisioning: 'cloud-init' };

export function ImagesScreen() {
  const images = useQuery('images.list', undefined);
  const act = useAction();
  const [meta, setMeta] = useState<ImageMeta>(EMPTY);
  const [verify, setVerify] = useState<Record<string, boolean>>({});
  const set = (k: keyof ImageMeta) => (e: { target: { value: string } }) => setMeta({ ...meta, [k]: e.target.value });

  const register = async () => {
    const r = await act.run('register', () => call('images.pickAndRegister', meta));
    if (r) {
      setMeta(EMPTY);
      void images.reload();
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>Image manager</h1>
        <p className="muted">Base images are copied into the app store, hashed, made read-only and never modified. Guests get copy-on-write disks on top.</p>
      </div>
      <ErrorBox error={images.error ?? act.error} onClose={() => act.setError(null)} />
      <Section title="Register a base image">
        <div className="form-grid">
          <Field label="Name"><input value={meta.name} onChange={set('name')} placeholder="Debian 13 generic cloud" /></Field>
          <Field label="Version"><input value={meta.version} onChange={set('version')} placeholder="20260901" /></Field>
          <Field label="Origin (download URL)"><input value={meta.origin} onChange={set('origin')} placeholder="https://cloud.debian.org/…" /></Field>
          <Field label="Guest OS">
            <select value={meta.guestOs} onChange={set('guestOs')}>
              <option value="linux">linux</option><option value="windows">windows</option><option value="macos">macos</option>
            </select>
          </Field>
          <Field label="Guest architecture">
            <select value={meta.guestArch} onChange={set('guestArch')}>
              <option value="aarch64">aarch64</option><option value="x86_64">x86_64</option>
            </select>
          </Field>
          <Field label="Provisioning" hint="cloud-init images get the preset applied on first boot">
            <select value={meta.provisioning} onChange={set('provisioning')}>
              <option value="cloud-init">cloud-init (e.g. Debian generic cloud image)</option>
              <option value="manual">manual (installed by hand)</option>
            </select>
          </Field>
          <Field label="Published SHA-256 or SHA-512 (optional)" hint="If given, a mismatch rejects the image">
            <input value={meta.expectedSha256} onChange={set('expectedSha256')} />
          </Field>
        </div>
        <Field label="Licence notes"><textarea value={meta.licenseNotes} onChange={set('licenseNotes')} placeholder="Licence, redistribution terms, university licence reference…" /></Field>
        <div className="row gap" style={{ marginTop: 12 }}>
          <button className="primary" disabled={!meta.name || !meta.version || !meta.origin || !!act.busy} onClick={register}>
            {act.busy === 'register' ? 'Copying and hashing…' : 'Choose file and register'}
          </button>
        </div>
      </Section>
      <Section title="Registered images">
        {images.data?.length === 0 && <p className="muted">No images yet.</p>}
        {!!images.data?.length && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>OS / arch</th><th>Provisioning</th><th>Size</th><th>SHA-256</th><th>Origin</th><th>Added</th><th /></tr></thead>
              <tbody>
                {images.data.map((i) => (
                  <tr key={i.id}>
                    <td>{i.name} <span className="muted">{i.version}</span></td>
                    <td>{i.guestOs} / {i.guestArch}</td>
                    <td>{i.provisioning}</td>
                    <td>{fmtMb(Math.round(i.sizeBytes / 1024 / 1024))}</td>
                    <td><code title={i.sha256}>{i.sha256.slice(0, 16)}…</code></td>
                    <td className="muted" style={{ maxWidth: 220 }}>{i.origin}</td>
                    <td>{fmtTime(i.addedAt)}</td>
                    <td>
                      {verify[i.id] === undefined ? (
                        <button disabled={!!act.busy} onClick={async () => {
                          const r = await act.run('verify', () => call('images.verify', { id: i.id }));
                          if (r) setVerify({ ...verify, [i.id]: r.match });
                        }}>Verify</button>
                      ) : verify[i.id] ? <Pill tone="ok">hash matches</Pill> : <Pill tone="bad">hash changed</Pill>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
