import { RootFilters, RootFilterSelect } from './RootFilters';
import { Button } from '@/components/Button';
import { SidebarDock } from '@/components/SidebarDock';
import { ROOT_USER_STATUS_OPTIONS, rootUsersUrl, type RootUsersSearch } from '@/lib/root-users';
import type { loadRootUsers } from './users';

type UserPage = Awaited<ReturnType<typeof loadRootUsers>> | null;

export function RootUserFilters({ values, page, searchMaxCharacters }: { values: RootUsersSearch; page: UserPage; searchMaxCharacters: number | null }) {
  const search = page?.query ?? (typeof values.q === 'string' ? values.q : '');
  const status = page?.status ?? (typeof values.status === 'string' ? values.status : 'all');
  return <SidebarDock><section aria-label="User directory filters" className="root-user-filters">
    <RootFilters title="Directory filters" route="/root/users" filters={[{ key: 'q', label: 'Name or email', value: search }, { key: 'status', label: 'Account status', value: status === 'all' ? '' : String(status) }].filter(item => item.value)}>
    <form key={JSON.stringify([search, status])} noValidate action="/root/users" method="get">
      <label className="ui-field">Name or email<input className="ui-input" type="search" name="q" defaultValue={search} maxLength={page?.searchMaxCharacters ?? searchMaxCharacters ?? undefined} placeholder="Search users" /></label>
      <label className="ui-field">Account status<RootFilterSelect name="status" label="Account status" initialValue={String(status)} options={ROOT_USER_STATUS_OPTIONS} /></label>
      <Button type="submit" variant="primary">Apply filters</Button>
    </form>
    <a href={rootUsersUrl({})}>Reset filters</a>
    {page && <nav aria-label="User directory pages">
      <p>Page {page.page} of {Math.max(1, Math.ceil(page.total / page.take))}</p>
      {page.page > 1 && <a href={rootUsersUrl({ q: page.query, status: page.status, page: page.page - 1 })}>Previous</a>}
      {page.page * page.take < page.total && <a href={rootUsersUrl({ q: page.query, status: page.status, page: page.page + 1 })}>Next</a>}
    </nav>}
  </RootFilters></section></SidebarDock>;
}
