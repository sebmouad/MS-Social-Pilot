import { notFound } from 'next/navigation';

import { getBioBySlug } from '@/lib/bio';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const page = await getBioBySlug((await params).slug);
  return { title: page?.title ?? '' };
}

/** The public link-in-bio page: a title, a line about us, and the links. No account, no app around it. */
export default async function BioPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await getBioBySlug(slug);
  if (!page) notFound();
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center gap-6 px-4 py-12 text-center">
      {page.avatarUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={page.avatarUrl} alt="" className="h-24 w-24 rounded-full object-cover" />
      )}
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{page.title}</h1>
        {page.description && <p className="mt-2 text-sm text-slate-600">{page.description}</p>}
      </div>
      <ul className="w-full space-y-3">
        {page.links.map((link) => (
          <li key={link.id}>
            <a href={`/bio/${page.slug}/go/${link.id}`} rel="noopener noreferrer" className="btn-primary w-full justify-center py-3">
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
