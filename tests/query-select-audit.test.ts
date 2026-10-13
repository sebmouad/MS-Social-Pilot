import { describe, expect, it, vi } from 'vitest';
const navigation = vi.hoisted(() => ({ push: vi.fn(), query: 'page=7&status=all&target=page-a' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push }),
  usePathname: () => '/posts',
  useSearchParams: () => new URLSearchParams(navigation.query),
}));
import { QuerySelect } from '../src/components/QuerySelect';
describe('changing a URL filter', () => {
  it('returns to the first page and preserves the selected channel', () => {
    const element = QuerySelect({ param: 'status', value: 'all', label: 'Status', options: [] });
    const select = element.props.children[1];
    select.props.onChange({ target: { value: 'failed' } });
    const url = new URL(navigation.push.mock.calls.at(-1)![0], 'https://example.com');
    expect(url.searchParams.has('page')).toBe(false);
    expect(url.searchParams.get('target')).toBe('page-a');
    expect(url.searchParams.get('status')).toBe('failed');
  });
});
