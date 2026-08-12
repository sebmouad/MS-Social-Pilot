import { notFound } from 'next/navigation';

/**
 * A page that takes its time, so the loading skeleton can be seen.
 *
 * The skeleton is by nature the thing nobody looks at: it appears for as long
 * as the server takes and then it is gone, which makes it the easiest piece of
 * a UI to break without noticing. This route holds it still long enough to
 * assert on.
 *
 * Behind the same flag as `e2e-throw`, and a 404 without it. Not named with a
 * leading underscore: Next treats such a folder as private and would drop the
 * route altogether.
 */
export const dynamic = 'force-dynamic';

export default async function SlowPage() {
  if (process.env.E2E_ALLOW_THROW !== 'true') notFound();

  await new Promise((resolve) => setTimeout(resolve, 2_500));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Eventually</h1>
      <p className="text-sm text-slate-600">This page took its time on purpose.</p>
    </div>
  );
}
