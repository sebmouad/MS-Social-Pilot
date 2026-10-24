import { describe, expect, it } from 'vitest';
import { storedFieldRows } from '@/modules/ads/ui/stored-fields';
import { StoredFields } from '@/modules/ads/ui/stored-fields';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

describe('stored advertising fields', () => {
  it('keeps action values and nested provider measures readable', () => {
    expect(storedFieldRows([{ action_type: 'link_click', value: '12', attribution_windows: ['1d_click'] }])).toEqual([
      { label: 'Link Click', value: '12' },
      { label: 'Link Click · Attribution Windows · Item 1', value: '1d_click' },
    ]);
    expect(storedFieldRows({ website_purchase_roas: [{ value: 2.35 }], estimated: false, unavailable: null })).toEqual([
      { label: 'Website Purchase ROAS · Item 1 · Value', value: '2.35' },
      { label: 'Estimated', value: 'No' },
      { label: 'Unavailable', value: '—' },
    ]);
  });

  it('renders all stored measures as labeled rows rather than raw JSON', () => {
    const html = renderToStaticMarkup(createElement(StoredFields, { actions: [{ action_type: 'link_click', value: '12' }], fields: { website_purchase_roas: 2.35 } }));
    expect(html).toContain('Link Click');
    expect(html).toContain('Website Purchase ROAS');
    expect(html).not.toContain('action_type');
    expect(html).not.toContain('{&quot;');
  });

  it('never renders stored credential values in the customer report details', () => {
    const html = renderToStaticMarkup(createElement(StoredFields, {
      actions: [{ action_type: 'purchase', value: '2', accessToken: 'private-token' }],
      fields: { nested: { authorization: 'Bearer private', safeMetric: 3 } },
    }));
    expect(html).toContain('[REDACTED]');
    expect(html).not.toContain('private-token');
    expect(html).not.toContain('Bearer private');
    expect(html).toContain('Safe Metric');
  });
});
