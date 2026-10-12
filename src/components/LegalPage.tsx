import type { ReactNode } from 'react';

export interface LegalSection {
  title: string;
  body: ReactNode;
}

/**
 * The layout the legal notices share — terms and privacy policy — with links
 * between the notices at the foot.
 */
export function LegalPage({ title, updated, sections }: { title: string; updated: string; sections: LegalSection[] }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-12 sm:px-6">
      <article className="card p-6 sm:p-8">
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{title}</h1>
        <p className="mt-1 text-xs text-slate-500">{updated}</p>
        {sections.map((section) => (
          <section key={section.title}>
            <h2 className="mt-6 text-sm font-semibold text-slate-900">{section.title}</h2>
            <div className="mt-2 text-sm text-slate-600">{section.body}</div>
          </section>
        ))}
      </article>
      <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
        <a className="underline" href="/terms">
          Terms of service
        </a>
        <a className="underline" href="/privacy-policy">
          Privacy policy
        </a>
        <a className="underline" href="/data-deletion">
          Data deletion
        </a>
      </nav>
    </main>
  );
}
