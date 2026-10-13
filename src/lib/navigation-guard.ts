/** One active editor owns navigation protection; no server dependencies. */
let guard: (() => Promise<boolean>) | null = null;
export function registerNavigationGuard(next: () => Promise<boolean>) {
  guard = next;
  return () => { if (guard === next) guard = null; };
}
export function mayLeaveEditor(): Promise<boolean> { return guard ? guard() : Promise.resolve(true); }
