// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuditExport } from '@/app/root/activity/AuditControls';
import { ROOT_AUDIT_CONTROLS_COPY } from '@/lib/config/root-audit-controls';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('Root audit download settings', () => {
  it('uses configured copy, filename and object URL release delay', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    const created = vi.fn(() => 'blob:example');
    const released = vi.fn();
    vi.stubGlobal('URL', class extends URL { static createObjectURL = created; static revokeObjectURL = released; });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('action\nconfig.changed', { headers: { 'content-type': 'text/csv' } })));
    let filename = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; });
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(AuditExport, { href: '/api/root/activity/export', limit: 5, copy: { ...ROOT_AUDIT_CONTROLS_COPY, export: 'Download history', prepared: 'History ready' }, downloadPolicy: { objectUrlReleaseMs: 2000, filename: 'history.csv' } })));
      await act(async () => container.querySelector('button')!.click());
      expect(filename).toBe('history.csv');
      expect(container.textContent).toContain('History ready');
      expect(created).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(1999); expect(released).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1); expect(released).toHaveBeenCalledWith('blob:example');
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
});
