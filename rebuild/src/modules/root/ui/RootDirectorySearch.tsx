import { RootFilters } from './RootFilters';
import { SidebarDock } from '@/components/SidebarDock';
import { loadRootInterfaceCopy } from './interface-copy';

export async function RootDirectorySearch({ kind, query }: { kind: 'users' | 'workspaces'; query: string }) {
  const copy = await loadRootInterfaceCopy();
  return <SidebarDock><RootFilters title={copy.dirFiltersTitle} route={`/root/${kind}`} filters={query ? [{ key: 'q', label: copy.search, value: query }] : []}><form key={query} noValidate className="root-directory__search" action={`/root/${kind}`}>
    <p className="shell-subnav__label">{copy.dirFiltersTitle}</p>
    <label className="ui-field">{kind === 'users' ? copy.dirSearchUsers : copy.dirSearchWorkspaces}<input className="ui-input" name="q" defaultValue={query} placeholder={kind === 'users' ? copy.userNameEmail : copy.dirNameSlug} /></label>
    <button type="submit" className="ui-button ui-button--secondary">{copy.search}</button>
    {query && <a href={`/root/${kind}`}>{copy.dirResetSearch}</a>}
  </form></RootFilters></SidebarDock>;
}
