import { INSTRUMENT_FIELDS, INSTRUMENT_VERSION, REASON_CODES } from '@lvd/shared';

export default function Home() {
  return (
    <main>
      <h1>University test service</h1>
      <p>
        Instrument version <code>{INSTRUMENT_VERSION}</code>. Study pages live at <code>/t/&lt;run token&gt;</code> and
        only accept run tokens registered by the control app. This index lists every field the instrument defines, how it
        is collected, and its privacy review status.
      </p>

      <h2>Field dictionary</h2>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Field</th><th>Method</th><th>Stability</th><th>Sensitivity</th><th>Review</th><th>Note</th></tr>
          </thead>
          <tbody>
            {INSTRUMENT_FIELDS.map((f) => (
              <tr key={f.id}>
                <td><code>{f.id}</code></td>
                <td>{f.method}</td>
                <td>{f.stability}</td>
                <td>{f.sensitivity}</td>
                <td className={f.reviewStatus === 'approved' ? 'ok' : 'absent'}>{f.reviewStatus}</td>
                <td>{f.privacyNote}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Absence reason codes</h2>
      <p>{REASON_CODES.map((r) => <span key={r} className="pill" style={{ marginRight: 6 }}>{r}</span>)}</p>
    </main>
  );
}
