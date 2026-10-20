import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ config: vi.fn(), change: vi.fn() }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: m.config }));
vi.mock('@/server/connection-mutations', () => ({ setConnectionSelections: m.change }));
import { changeConnectionSelections } from '@/modules/settings/server/connection-selection';
const actor = { userId: 'u', workspaceId: 'w' };
const items = [{ kind: 'target', id: 'a', enabled: true }, { kind: 'adAccount', id: 'b', enabled: false }];
beforeEach(() => { vi.clearAllMocks(); m.config.mockResolvedValue(2); });
it('uses one atomic core mutation after exact count confirmation', async () => {
  await expect(changeConnectionSelections(actor, { items, confirmation: 'SET CONNECTION SELECTIONS 2' })).resolves.toEqual({ ok: true, changed: 2 });
  expect(m.change).toHaveBeenCalledWith(actor, items);
});
it.each([{ items, confirmation: 'SET CONNECTION SELECTIONS 1' }, { items: [...items, ...items], confirmation: 'SET CONNECTION SELECTIONS 4' }, { items: [], confirmation: 'SET CONNECTION SELECTIONS 0' }])('refuses mismatched or out-of-policy selections before dispatch', async input => {
  await expect(changeConnectionSelections(actor, input)).rejects.toMatchObject({ code: 'invalid_request' });
  expect(m.change).not.toHaveBeenCalled();
});
