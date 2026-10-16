import { Button } from '@/components/Button';
import { SidebarDock } from '@/components/SidebarDock';
import { ROOT_USER_STATUS_OPTIONS, rootUsersUrl, type RootUsersSearch } from '@/lib/root-users';
import type { loadRootUsers } from './users';

type UserPage = Awaited<ReturnType<typeof loadRootUsers>> | null;

export function RootUserFilters({ values, page, searchMaxCharacters }: { values: RootUsersSearch; page: UserPage; searchMaxCharacters: number | null }) {
  const search = page?.query ?? (typeof values.q === 'string' ? values.q : '');
  const status = page?.status ?? (typeof values.status === 'string' && ROOT_USER_STATUS_OPTIONS.some(option => option.value === values.status) ? values.status as NonNullable<RootUsersSearch['status']> : 'all');
  return <SidebarDock><section aria-label="User directory filters" className="root-user-filters">
    <p className="shell-subnav__label">Directory filters</p>
    <form noValidate action="/root/users" method="get">
      <label className="ui-field">Name or email<input className="ui-input" type="search" name="q" defaultValue={search} maxLength={page?.searchMaxCharacters ?? searchMaxCharacters ?? undefined} placeholder="Search users" /></label>
      <label className="ui-field">Account status<select className="ui-input" name="status" defaultValue={status}>{ROOT_USER_STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <Button type="submit" variant="primary">Apply filters</Button>
    </form>
    <a href={rootUsersUrl({})}>Reset filters</a>
    {page && <nav aria-label="User directory pages">
      <p>Page {page.page} of {Math.max(1, Math.ceil(page.total / page.take))}</p>
      {page.page > 1 && <a href={rootUsersUrl({ q: page.query, status: page.status, page: page.page - 1 })}>Previous</a>}
      {page.page * page.take < page.total && <a href={rootUsersUrl({ q: page.query, status: page.status, page: page.page + 1 })}>Next</a>}
    </nav>}
  </section></SidebarDock>;
}
