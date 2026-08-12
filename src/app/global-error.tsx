'use client';

/**
 * The last resort: the root layout itself failed.
 *
 * This replaces the whole document, `<html>` and `<body>` included, which
 * means none of the app's own scaffolding is available — no translation
 * provider, no stylesheet guaranteed to have loaded. So it is deliberately
 * plain and deliberately English: a page that tried to translate itself here
 * would throw inside the handler for a throw.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          margin: 0,
          padding: '1.5rem',
          textAlign: 'center',
          color: '#0f172a',
        }}
      >
        <div style={{ maxWidth: '28rem' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ marginTop: '0.75rem', fontSize: '0.875rem', color: '#475569' }}>
            The application could not start. Trying again is worth a moment; if it keeps
            happening, the reference below identifies it in the server log.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: '1.5rem',
              padding: '0.5rem 1rem',
              borderRadius: '0.5rem',
              border: 0,
              background: '#0f172a',
              color: 'white',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ marginTop: '1.5rem', fontSize: '0.75rem', color: '#94a3b8' }}>
              Reference: <code>{error.digest}</code>
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
