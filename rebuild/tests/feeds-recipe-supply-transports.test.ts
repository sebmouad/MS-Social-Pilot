import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ read: vi.fn(), viewer: vi.fn() }));
vi.mock('../src/modules/feeds/server/wordpress', async importOriginal => ({ ...(await importOriginal<Record<string, unknown>>()), readRecipeSource: state.read }));
vi.mock('@/server/context', () => ({ requireViewer: state.viewer }));
vi.mock('@/server/request-origin', () => ({ requestOrigin: () => 'https://example.test' }));
import { GET } from '../src/app/api/feeds/wordpress/route';
import { executeFeedTool } from '../src/modules/feeds/mcp';
import { RecipeSupplyCard } from '../src/modules/feeds/ui/RecipeSupplyCard';
import { renderToStaticMarkup } from 'react-dom/server';
import { recipeCopy } from '../src/modules/feeds/copy-recipes';
vi.mock('@/server/config/store', async importOriginal => ({ ...(await importOriginal<Record<string, unknown>>()), runtimeConfig: async (key: string) => key === 'feeds.recipeCopy' ? recipeCopy : undefined }));

const actor = { userId: 'u', workspaceId: 'w' };
const result = {
  source: { id: 'source' },
  pool: { asOf: '2026-10-21T00:00:00Z', complete: true, warnDays: 14, low: true, pages: [{ targetId: 't', targetName: 'Example channel', eligible: 4, daysLeft: 1, low: true }] },
  reuse: { enabled: false, cooldownDays: 365 },
};
beforeEach(() => {
  vi.clearAllMocks();
  state.read.mockResolvedValue(result);
  state.viewer.mockResolvedValue({ user: { id: 'u' }, workspaceId: 'w' });
});

describe('supply status transports and Home integration component', () => {
  it('returns the identical shared-service status through REST and MCP', async () => {
    const response = await GET(new Request('https://example.test/api/feeds/wordpress?page=2'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(result);
    expect(await executeFeedTool(actor, 'get_recipe_source', { page: 2 })).toEqual(result);
    expect(state.read.mock.calls).toEqual([[actor, { page: 2 }], [actor, { page: 2 }]]);
  });
  it('does not load supply for an unauthenticated REST read', async () => {
    state.viewer.mockRejectedValue(new Error('no session'));
    const response = await GET(new Request('https://example.test/api/feeds/wordpress'));
    expect(response.status).toBe(401);
    expect(state.read).not.toHaveBeenCalled();
  });
  it('renders the Home card warning through the authorized read service and Root copy', async () => {
    const card = await RecipeSupplyCard({ actor, locale: 'fr' });
    expect(card).not.toBeNull();
    const html = renderToStaticMarkup(card!);
    expect(html).toContain('Réserve de recettes');
    expect(html).toContain('moins de 14 jours restants');
    expect(state.read).toHaveBeenCalledWith(actor);
  });
  it('omits the Home card when access is refused or no visible source exists', async () => {
    state.read.mockRejectedValueOnce(new Error('forbidden')).mockResolvedValueOnce({ source: null });
    expect(await RecipeSupplyCard({ actor, locale: 'en' })).toBeNull();
    expect(await RecipeSupplyCard({ actor, locale: 'en' })).toBeNull();
  });
});
