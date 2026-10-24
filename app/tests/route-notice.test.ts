// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { RouteNotice } from '../src/components/RouteNotice';
it('focuses a result that survives removal of its initiating row and focuses each new operation', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(RouteNotice, { focusKey: 'operation-a', children: 'Local record updated.' })));
    expect(document.activeElement?.getAttribute('role')).toBe('status');
    document.body.tabIndex = -1; document.body.focus();
    await act(async () => root.render(createElement(RouteNotice, { focusKey: 'operation-b', children: 'Local record updated.' })));
    expect(document.activeElement?.textContent).toBe('Local record updated.');
  } finally { await act(async () => root.unmount()); container.remove(); document.body.removeAttribute('tabindex'); }
});
