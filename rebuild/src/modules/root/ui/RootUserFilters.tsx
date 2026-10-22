import { RootFilters, RootFilterSelect } from './RootFilters';
import { Button } from '@/components/Button';
import { SidebarDock } from '@/components/SidebarDock';
import { ROOT_USER_STATUS_OPTIONS, rootUsersUrl, type RootUsersSearch } from '@/lib/root-users';
import type { loadRootUsers } from '@/server/root/users';
import { configCopyText } from '@/lib/config/root-config-copy';
import { loadRootInterfaceCopy } from './interface-copy';

type UserPage = Awaited<ReturnType<typeof loadRootUsers>> | null;

export async function RootUserFilters({ values, page, searchMaxCharacters }: { values: RootUsersSearch; page: UserPage; searchMaxCharacters: number | null }) {
  const search = page?.query ?? (typeof values.q === 'string' ? values.q : '');
  const status = page?.status ?? (typeof values.status === 'string' ? values.status : 'all');
  const copy = await loadRootInterfaceCopy();
  return <SidebarDock><section aria-label={copy.userFiltersTitle} className="root-user-filters">
    <RootFilters title={copy.dirFiltersTitle} route="/root/users" filters={[{ key: 'q', label: copy.userNameEmail, value: search }, { key: 'status', label: copy.userAccountStatus, value: status === 'all' ? '' : String(status) }].filter(item => item.value)}>
    <form key={JSON.stringify([search, status])} noValidate action="/root/users" method="get">
      <label className="ui-field">{copy.userNameEmail}<input className="ui-input" type="search" name="q" defaultValue={search} maxLength={page?.searchMaxCharacters ?? searchMaxCharacters ?? undefined} placeholder={copy.userSearchUsers} /></label>
      <label className="ui-field">{copy.userAccountStatus}<RootFilterSelect name="status" label={copy.userAccountStatus} initialValue={String(status)} options={ROOT_USER_STATUS_OPTIONS} /></label>
      <Button type="submit" variant="primary">{copy.applyFilters}</Button>
    </form>
    <a href={rootUsersUrl({})}>{copy.reset}</a>
    {page && <nav aria-label={copy.userDirectoryPages}>
      <p>{configCopyText(copy.userPageOf, { page: page.page, total: Math.max(1, Math.ceil(page.total / page.take)) })}</p>
      {page.page > 1 && <a href={rootUsersUrl({ q: page.query, status: page.status, page: page.page - 1 })}>{copy.userPrevious}</a>}
      {page.page * page.take < page.total && <a href={rootUsersUrl({ q: page.query, status: page.status, page: page.page + 1 })}>{copy.userNext}</a>}
    </nav>}
  </RootFilters></section></SidebarDock>;
}
