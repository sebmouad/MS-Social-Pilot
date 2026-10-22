import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GrantChips } from '@/modules/settings/ui/connections/GrantChips';
import { rootPageIcon } from '@/modules/root/ui/RootNavIcons';
import { rootManifest } from '@/modules/root/manifest';
import { buildBarModel } from '@/components/charts/BarChart';

describe('design round 2', () => {
  const grants = [
    { id: 'publish', label: 'Publish posts', state: 'granted' as const },
    { id: 'inbox', label: 'Read messages', state: 'missing' as const },
    { id: 'misc', label: 'Other', state: 'unknown' as const },
  ];

  it('groups permission chips by state behind a disclosure, in both languages', () => {
    const en = renderToStaticMarkup(createElement(GrantChips, { grants, locale: 'en', label: 'Permissions' }));
    expect(en).toContain('1 of 3 permissions');
    expect(en).toContain('<details');
    expect(en.indexOf('Not allowed')).toBeLessThan(en.indexOf('Allowed<'));
    const fr = renderToStaticMarkup(createElement(GrantChips, { grants, locale: 'fr', label: 'Autorisations' }));
    expect(fr).toContain('1 autorisations sur 3');
    expect(renderToStaticMarkup(createElement(GrantChips, { grants: [], locale: 'en', label: 'x' }))).toBe('');
  });

  it('gives every Root sidebar page an icon', () => {
    for (const section of rootManifest.sections) for (const page of section.pages) expect(rootPageIcon(page.href)).toBeTruthy();
  });

  it('rounds bar ends on non-stacked charts', () => {
    const model = buildBarModel({ label: 'x', categories: ['a'], series: [{ id: 's', name: 'S', values: [1] }] } as never);
    const option = model.option({ theme: { palette: ['#111'], grid: '', text: '', surface: '', accent: '', ink: '', inkSoft: '', line: '' }, reducedMotion: true }) as { series: Array<{ itemStyle: { borderRadius: unknown } }> };
    expect(option.series[0]!.itemStyle.borderRadius).toBeTruthy();
  });
});
