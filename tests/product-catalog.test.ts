import { describe, expect, it } from 'vitest';

import { enabledProductFeatures, productFeatureOfPath } from '../src/lib/product-catalog';

describe('product feature catalogue', () => {
  it('maps nested screens and mutation routes to one feature', () => {
    expect(productFeatureOfPath('/calendar')).toBe('publishing/calendar');
    expect(productFeatureOfPath('/api/posts/123')).toBe('publishing/posts');
    expect(productFeatureOfPath('/api/posts/123/approve')).toBe('publishing/approvals');
    expect(productFeatureOfPath('/api/ads')).toBe('ads/performance');
    expect(productFeatureOfPath('/settings/team')).toBe('settings/team');
    expect(productFeatureOfPath('/postscript')).toBeNull();
  });

  it('preserves legacy plans and requires enabled parents in modular plans', () => {
    expect(enabledProductFeatures([], [])).toContain('publishing/posts');
    expect(enabledProductFeatures([], ['product_v2', 'publishing/calendar'])).not.toContain('publishing/calendar');
    expect(enabledProductFeatures([], ['product_v2', 'publishing/posts', 'publishing/calendar'])).toContain('publishing/calendar');
    expect(enabledProductFeatures(['publishing/posts'], ['product_v2', 'publishing/posts', 'publishing/calendar'])).not.toContain('publishing/calendar');
  });
});
