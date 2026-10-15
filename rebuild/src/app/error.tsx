'use client';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="route-state" role="alert">
    <h1>We couldn’t load this page</h1>
    <p>Your work is still here. Try loading the page again.</p>
    <button type="button" className="ui-button ui-button--primary ui-button--md" onClick={reset}>Try again</button>
  </main>;
}
