// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('q=launch&status=published&channel=channel-7&page=4&view=cards') }));
vi.mock('../src/modules/publishing/ui/publishing.module.css', () => ({ default: { help: 'help', successNotice: 'success', errorNotice: 'error' } }));

import { PostExport } from '../src/modules/publishing/ui/posts/PostExport';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const response = (options: { ok?: boolean; type?: string; format?: string | null; count?: string | null; bytes?: string | null; body?: string } = {}) => {
  const body = options.body ?? 'post_id,message\n1,launch';
  return {
    ok: options.ok ?? true,
    headers: new Headers({
      'content-type': options.type ?? 'text/csv; charset=utf-8',
      'x-msp-export-format': options.format ?? 'posts-v1',
      'x-msp-post-count': options.count ?? '1',
      'x-msp-export-bytes': options.bytes ?? String(new TextEncoder().encode(body).byteLength),
    }),
    blob: async () => new Blob([body], { type: 'text/csv' }),
    json: async () => ({ code: 'invalid_request', error: 'narrow filters' }),
  };
};

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:posts'), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(createElement(PostExport, { maxPosts: 5000, maxBytes: 1024 })));
});

afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function clickExport() { await act(async () => container.querySelector<HTMLButtonElement>('button')!.click()); }

describe('PostExport', () => {
  it('sends only committed filters and blocks duplicate requests while pending', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(fetch).mockReturnValue(new Promise(resolve => { finish = resolve; }) as never);
    await act(async () => {
      const button = container.querySelector<HTMLButtonElement>('button')!;
      button.click();
      button.click();
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/api/publishing/posts/export?q=launch&status=published&channel=channel-7');
    expect(container.querySelector('button')?.disabled).toBe(true);
    await clickExport();
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => finish(response()));
  });

  it('refuses an unconfirmed format or byte count and focuses a safe error', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ type: 'application/json' }) as never);
    await clickExport();
    expect(container.querySelector('[role=alert]')?.textContent).toContain('CSV could not be confirmed');
    expect(container.querySelector('[role=alert]')).toBe(document.activeElement);
    expect(URL.createObjectURL).not.toHaveBeenCalled();

    vi.mocked(fetch).mockResolvedValue(response({ bytes: '2048' }) as never);
    await clickExport();
    expect(container.querySelector('[role=alert]')?.textContent).toContain('CSV could not be confirmed');
    expect(URL.createObjectURL).not.toHaveBeenCalled();

    vi.mocked(fetch).mockResolvedValue(response({ bytes: '19' }) as never);
    await clickExport();
    expect(container.querySelector('[role=alert]')?.textContent).toContain('CSV could not be confirmed');
    expect(URL.createObjectURL).not.toHaveBeenCalled();

    vi.mocked(fetch).mockResolvedValue(response({ count: '5001' }) as never);
    await clickExport();
    expect(container.querySelector('[role=alert]')?.textContent).toContain('CSV could not be confirmed');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('uses only known error codes and never surfaces server details', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ code: 'upstream_failure', error: 'private provider token and stack trace' }),
    } as never);
    await clickExport();

    expect(container.querySelector('[role=alert]')?.textContent).toContain('CSV could not be confirmed');
    expect(container.textContent).not.toMatch(/private provider token|stack trace/);
    expect(URL.createObjectURL).not.toHaveBeenCalled();

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ code: 'invalid_request', error: 'private count and byte ceiling details' }),
    } as never);
    await clickExport();
    expect(container.querySelector('[role=alert]')?.textContent).toContain('narrow them to fit the configured export limit');
    expect(container.textContent).not.toMatch(/private count|byte ceiling details/);
  });

  it('downloads a verified CSV and announces the prepared matching post count', async () => {
    const click = vi.mocked(HTMLAnchorElement.prototype.click);
    vi.mocked(fetch).mockResolvedValue(response({ count: '3' }) as never);
    await clickExport();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role=status]')?.textContent).toBe('Prepared CSV for 3 posts.');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:posts');
  });
});
