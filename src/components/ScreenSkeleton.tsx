/**
 * What fills the screen while the next one is being built.
 *
 * Every screen behind the sign-in wall is `force-dynamic`, so a navigation
 * waits on the server. Without a loading boundary Next keeps the *previous*
 * page on screen meanwhile: press a slow screen and, for as long as its
 * queries take, nothing happens at all. The natural conclusion is that the
 * click missed.
 *
 * Shapes rather than a spinner: a spinner says "wait", these say "a heading
 * and some rows are coming", and the page does not jump when they are
 * replaced.
 *
 * Each screen re-exports this as its own `loading.tsx` rather than one file
 * covering the whole group, and that is not tidiness. A loading boundary makes
 * Next flush the response before the page has finished deciding, so a page
 * that then calls `notFound()` answers **200** with the not-found page in the
 * body. `/compose` and the single-post analytics screen both do exactly that,
 * for links that were valid yesterday, so neither gets a boundary and both
 * keep answering 404 as they should.
 */
export function ScreenSkeleton() {
  return (
    <div className="animate-pulse space-y-6" aria-hidden="true">
      <div className="space-y-2">
        <div className="h-6 w-48 rounded bg-slate-200" />
        <div className="h-4 w-72 max-w-full rounded bg-slate-100" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="card h-24 p-5">
            <div className="h-3 w-20 rounded bg-slate-100" />
            <div className="mt-3 h-6 w-16 rounded bg-slate-200" />
          </div>
        ))}
      </div>

      <div className="card divide-y divide-slate-100">
        {[0, 1, 2, 3, 4].map((index) => (
          <div key={index} className="flex items-center gap-3 p-4">
            <div className="h-4 flex-1 rounded bg-slate-100" />
            <div className="h-4 w-20 rounded bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
