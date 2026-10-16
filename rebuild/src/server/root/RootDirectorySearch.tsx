import { SidebarDock } from '@/components/SidebarDock';

export function RootDirectorySearch({ kind, query }: { kind: 'users' | 'workspaces'; query: string }) {
  return <SidebarDock><form className="root-directory__search" action={`/root/${kind}`}>
    <p className="shell-subnav__label">Directory filters</p>
    <label className="ui-field">Search {kind}<input className="ui-input" name="q" defaultValue={query} placeholder={kind === 'users' ? 'Name or email' : 'Name or slug'} /></label>
    <button type="submit" className="ui-button ui-button--secondary">Search</button>
    {query && <a href={`/root/${kind}`}>Reset search</a>}
  </form></SidebarDock>;
}
