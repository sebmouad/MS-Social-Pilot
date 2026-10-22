// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AnalyticsChannelChoices } from '../src/modules/analytics/ui/AnalyticsFilters';
import { InboxFilterRow } from '../src/modules/inbox/ui/InboxFilterRow';

const channels = [{ id: 'ig-atlas', name: 'Atelier Atlas · Instagram' }, { id: 'other', name: 'Atlas Updates' }];
describe('neutral customer channel choices', () => {
  it('retains Instagram and other service-authorized analytics channels and selection', () => {
    const host = document.createElement('form');
    host.innerHTML = renderToStaticMarkup(createElement(AnalyticsChannelChoices, { channels, selectedIds: ['ig-atlas'] }));
    expect(host.textContent).toContain(channels[0]!.name);
    expect(host.querySelectorAll('input')).toHaveLength(2);
    expect(new FormData(host).getAll('channel')).toEqual(['ig-atlas']);
    host.innerHTML = renderToStaticMarkup(createElement(AnalyticsChannelChoices, { channels: [], selectedIds: ['ig-atlas'] }));
    expect(host.querySelectorAll('input')).toHaveLength(0);
  });
  it.each(['en', 'fr'] as const)('leaves the channel choice to the sidebar and carries its scope through the Inbox filter form in %s', async locale => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(InboxFilterRow, { action: '/inbox', resetHref: '/inbox', scope: 'ig-atlas,other', locale, disabledLimit: false, activeCount: 0,
        filters: { channelId: null, kind: 'all', state: 'open', hidden: 'visible', q: '' } })));
      await act(async () => host.querySelector<HTMLButtonElement>('button.ui-filter-button')!.click());
      // The scope is a hidden field, so filtering keeps it; there is no channel picker of its own any more.
      expect(host.querySelector<HTMLInputElement>('input[type=hidden][name=channel]')?.value).toBe('ig-atlas,other');
      expect([...host.querySelectorAll<HTMLElement>('[role=combobox]')].some(el => el.textContent?.includes(channels[0]!.name))).toBe(false);
      expect(host.querySelector('select[name=channel], input[type=text][name=channel]')).toBeNull();
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
