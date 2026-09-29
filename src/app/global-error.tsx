'use client';

/**
 * The last resort: the root layout itself failed.
 *
 * This replaces the whole document, `<html>` and `<body>` included, which
 * means none of the app's own scaffolding is available — no translation
 * provider, no stylesheet guaranteed to have loaded, and no reliable way to
 * learn the reader's language (the locale is resolved by the very layout that
 * just threw). A page that tried to translate itself here would throw inside
 * the handler for a throw.
 *
 * So it says everything in both of the app's languages, statically. Two short
 * paragraphs cost less than a French-speaking client being shown only English
 * on the one screen where they most need to understand what happened.
 */
const COPY = [
  {
    lang: 'en',
    title: 'Something went wrong',
    body: 'The application could not start. Trying again is worth a moment; if it keeps happening, the reference below identifies it in the server log.',
  },
  {
    lang: 'fr',
    title: 'Une erreur est survenue',
    body: 'L’application n’a pas pu démarrer. Un nouvel essai vaut la peine ; si le problème persiste, la référence ci-dessous permet de le retrouver dans le journal du serveur.',
  },
] as const;

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
          background: 'white',
        }}
      >
        <main style={{ maxWidth: '28rem' }}>
          {COPY.map((copy, index) => (
            // `lang` per block, so a screen reader switches voice for the French.
            <div key={copy.lang} lang={copy.lang} style={{ marginTop: index === 0 ? 0 : '1.5rem' }}>
              {index === 0 ? (
                <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>{copy.title}</h1>
              ) : (
                <h2 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>{copy.title}</h2>
              )}
              <p style={{ marginTop: '0.75rem', fontSize: '0.875rem', color: '#475569' }}>{copy.body}</p>
            </div>
          ))}
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
            Try again · <span lang="fr">Réessayer</span>
          </button>
          {error.digest && (
            <p style={{ marginTop: '1.5rem', fontSize: '0.75rem', color: '#64748b' }}>
              Reference · <span lang="fr">Référence</span> : <code>{error.digest}</code>
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
