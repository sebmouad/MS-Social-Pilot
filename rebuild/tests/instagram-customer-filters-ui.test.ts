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
  it.each(['en', 'fr'] as const)('offers Instagram in the searchable inbox channel filter in %s', async locale => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(InboxFilterRow, { action: '/inbox', resetHref: '/inbox', channels, locale, disabledLimit: false, activeCount: 1,
        filters: { channelId: 'ig-atlas', kind: 'all', state: 'open', hidden: 'visible', q: '' } })));
      // The channel list lives behind the page's single Filter button.
      await act(async () => host.querySelector<HTMLButtonElement>('button.ui-filter-button')!.click());
      expect(host.querySelector<HTMLInputElement>('input[name=channel]')?.value).toBe('ig-atlas');
      const picker = [...host.querySelectorAll<HTMLElement>('[role=combobox]')].find(el => el.textContent?.includes(channels[0]!.name))!;
      expect(picker).toBeTruthy();
      await act(async () => picker.click());
      const option = [...document.querySelectorAll('[role=option]')].find(el => el.textContent?.includes(channels[0]!.name));
      expect(option).toBeTruthy();
      expect(option?.getAttribute('aria-selected')).toBe('true');
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
