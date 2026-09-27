import { TestRunner } from './TestRunner';

export const dynamic = 'force-dynamic';

export default async function TestPage(props: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await props.params;
  const sp = await props.searchParams;
  return (
    <main>
      <h1>Study observation page</h1>
      <p>
        This page records what the browser exposes and submits it to the university test service for run{' '}
        <code>{token.slice(0, 6)}…</code>. Missing values are recorded with a reason, never guessed.
      </p>
      <TestRunner runToken={token} requestGeolocation={sp.geo === '1'} placeStudyToken={sp.place === '1'} />
    </main>
  );
}
