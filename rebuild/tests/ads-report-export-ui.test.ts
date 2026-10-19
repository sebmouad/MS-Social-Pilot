// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CsvExportButton } from '../src/components/CsvExportButton';
import { AdsReportExport } from '../src/app/ads/AdsReportExport';
import { parseAdsFilters } from '@/modules/ads/server/queries';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const body = 'date,spend\r\n2026-10-02,3\r\n';
const response = (options: { format?: string; count?: string; bytes?: string; name?: string; ok?: boolean } = {}) => ({
  ok: options.ok ?? true,
  headers: new Headers({
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="${options.name ?? 'ads-report.csv'}"`,
    'x-msp-export-format': options.format ?? 'ads-daily-v1',
    'x-msp-row-count': options.count ?? '1',
    'x-msp-export-bytes': options.bytes ?? String(new TextEncoder().encode(body).byteLength),
  }),
  blob: async () => new Blob([body], { type: 'text/csv' }),
  json: async () => ({ code: 'invalid_request', error: 'secret row ceiling and provider text' }),
});

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:ads'), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});

afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function render(node: ReturnType<typeof createElement>) { await act(async () => root.render(node)); }
async function clickExport() { await act(async () => container.querySelector<HTMLButtonElement>('button')!.click()); }

describe('Ads report export UI', () => {
  it('builds the complete canonical export scope without the visible page number', async () => {
    const filters = parseAdsFilters({ period: 'custom', since: '2026-10-01', until: '2026-10-02', account: 'account-a' }, ['account-a']);
    await render(createElement(AdsReportExport, { filters, maxRows: 5000, maxBytes: 1024, fileName: 'ads-report.csv' }));
    expect(container.textContent).toContain('all matching daily rows');
    vi.mocked(fetch).mockResolvedValue(response() as never);
    await clickExport();
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/api/ads/report/export?period=custom&start=2026-10-01&end=2026-10-02&accountId=account-a');
    expect(container.querySelector('[role=status]')?.textContent).toBe('Prepared CSV for 1 daily row.');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('keeps a pending export single-flight and requires the service filename receipt', async () => {
    await render(createElement(CsvExportButton, {
      href: '/api/ads/report/export?period=14d', expectedFormat: 'ads-daily-v1', rowCountHeader: 'x-msp-row-count',
      maxRows: 10, maxBytes: 1024, fileName: 'ads-report.csv', requireFileNameConfirmation: true,
      copy: { heading: 'Export Ads report', help: 'Export all matching daily rows.', action: 'Export daily rows', pending: 'Preparing CSV…', noun: { singular: 'daily row', plural: 'daily rows' } },
    }));
    let finish!: (value: unknown) => void;
    vi.mocked(fetch).mockReturnValue(new Promise(resolve => { finish = resolve; }) as never);
    await act(async () => { const button = container.querySelector<HTMLButtonElement>('button')!; button.click(); button.click(); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(container.querySelector('button')?.disabled).toBe(true);
    await act(async () => finish(response({ name: 'other-report.csv' })));
    expect(container.querySelector('[role=alert]')?.textContent).toContain('could not be confirmed');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('aborts and ignores a deferred response after the export control unmounts', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(fetch).mockReturnValue(new Promise(resolve => { finish = resolve; }) as never);
    await render(createElement(CsvExportButton, {
      href: '/api/ads/report/export?period=14d', expectedFormat: 'ads-daily-v1', rowCountHeader: 'x-msp-row-count',
      maxRows: 10, maxBytes: 1024, fileName: 'ads-report.csv', requireFileNameConfirmation: true,
      copy: { heading: 'Export Ads report', help: 'Export all matching daily rows.', action: 'Export daily rows', pending: 'Preparing CSV…', noun: { singular: 'daily row', plural: 'daily rows' } },
    }));
    await clickExport();
    const signal = vi.mocked(fetch).mock.calls[0]?.[1]?.signal;
    await render(createElement('div'));
    expect(signal?.aborted).toBe(true);
    await act(async () => finish(response()));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });

  it('clears completed feedback when the applied export filters change', async () => {
    const copy = { heading: 'Export Ads report', help: 'Export all matching daily rows.', action: 'Export daily rows', pending: 'Preparing CSV…', noun: { singular: 'daily row', plural: 'daily rows' } };
    const button = (href: string) => createElement(CsvExportButton, {
      href, expectedFormat: 'ads-daily-v1', rowCountHeader: 'x-msp-row-count', maxRows: 10, maxBytes: 1024,
      fileName: 'ads-report.csv', requireFileNameConfirmation: true, copy,
    });
    await render(button('/api/ads/report/export?period=14d'));
    vi.mocked(fetch).mockResolvedValue(response() as never);
    await clickExport();
    expect(container.querySelector('[role=status]')?.textContent).toBe('Prepared CSV for 1 daily row.');

    await render(button('/api/ads/report/export?period=30d'));
    expect(container.querySelector('[role=status]')).toBeNull();
  });

  it.each(['href', 'filename'] as const)('cancels a stale export when %s changes and keeps the new request active', async changedProp => {
    const finishes: Array<(value: unknown) => void> = [];
    vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { finishes.push(resolve); }) as never);
    const copy = { heading: 'Export Ads report', help: 'Export all matching daily rows.', action: 'Export daily rows', pending: 'Preparing CSV…', noun: { singular: 'daily row', plural: 'daily rows' } };
    const button = (href: string, fileName: string) => createElement(CsvExportButton, {
      href, expectedFormat: 'ads-daily-v1', rowCountHeader: 'x-msp-row-count', maxRows: 10, maxBytes: 1024,
      fileName, requireFileNameConfirmation: true, copy,
    });
    const oldHref = '/api/ads/report/export?period=14d';
    const oldFileName = 'old-report.csv';
    const newHref = changedProp === 'href' ? '/api/ads/report/export?period=30d' : oldHref;
    const newFileName = changedProp === 'filename' ? 'new-report.csv' : oldFileName;
    await render(button(oldHref, oldFileName));
    await clickExport();
    const oldSignal = vi.mocked(fetch).mock.calls[0]?.[1]?.signal;
    await render(button(newHref, newFileName));
    expect(oldSignal?.aborted).toBe(true);
    expect(container.querySelector('button')?.disabled).toBe(false);

    await clickExport();
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => finishes[0](response({ name: oldFileName })));
    expect(container.querySelector('button')?.disabled).toBe(true);
    expect(container.querySelector('[role=status]')).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();

    await act(async () => finishes[1](response({ name: newFileName, count: '2' })));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role=status]')?.textContent).toBe('Prepared CSV for 2 daily rows.');
  });

  it('refuses over-limit or misreported UTF-8 bytes and focuses safe feedback', async () => {
    await render(createElement(CsvExportButton, {
      href: '/api/ads/report/export', expectedFormat: 'ads-daily-v1', rowCountHeader: 'x-msp-row-count',
      maxRows: 1, maxBytes: 1024, fileName: 'ads-report.csv', requireFileNameConfirmation: true,
      copy: { heading: 'Export Ads report', help: 'Export all matching daily rows.', action: 'Export daily rows', pending: 'Preparing CSV…', noun: { singular: 'daily row', plural: 'daily rows' } },
    }));
    vi.mocked(fetch).mockResolvedValue(response({ count: '2' }) as never);
    await clickExport();
    expect(container.querySelector('[role=alert]')).toBe(document.activeElement);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValue(response({ bytes: '10' }) as never);
    await clickExport();
    expect(container.querySelector('[role=alert]')?.textContent).toContain('could not be confirmed');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('uses safe error codes without exposing service details', async () => {
    await render(createElement(CsvExportButton, {
      href: '/api/ads/report/export', expectedFormat: 'ads-daily-v1', rowCountHeader: 'x-msp-row-count',
      maxRows: 10, maxBytes: 1024, fileName: 'ads-report.csv', requireFileNameConfirmation: true,
      copy: { heading: 'Export Ads report', help: 'Export all matching daily rows.', action: 'Export daily rows', pending: 'Preparing CSV…', noun: { singular: 'daily row', plural: 'daily rows' } },
    }));
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({ code: 'upstream_failure', error: 'token=secret private provider body' }) } as never);
    await clickExport();
    expect(container.querySelector('[role=alert]')?.textContent).toContain('could not be confirmed');
    expect(container.textContent).not.toMatch(/token=secret|private provider body/);
  });
});
