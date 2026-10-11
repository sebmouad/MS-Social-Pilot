import { beforeEach, describe, expect, it, vi } from 'vitest';

const list = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    models = { list };
  },
}));

const settings = { key: 'sk-test' as string | null, model: '' };
vi.mock('@/lib/env', () => ({
  env: {
    get anthropicApiKey() {
      return settings.key;
    },
    get aiModel() {
      return settings.model;
    },
  },
}));

const { listAiModels, resolveAiModel, clearAiModelCache } = await import('@/lib/ai-models');

function page(ids: string[]) {
  return (async function* () {
    for (const id of ids) yield { id, display_name: id.toUpperCase(), created_at: '2026-01-01T00:00:00Z' };
  })();
}

describe('AI models fetched from the provider', () => {
  beforeEach(() => {
    clearAiModelCache();
    list.mockReset();
    settings.key = 'sk-test';
    settings.model = '';
  });

  it('lists what the provider returns, in its order', async () => {
    list.mockReturnValue(page(['model-new', 'model-old']));
    expect((await listAiModels()).map((model) => model.id)).toEqual(['model-new', 'model-old']);
  });

  it('caches the list until a refresh is asked for', async () => {
    list.mockReturnValueOnce(page(['a'])).mockReturnValueOnce(page(['b']));
    await listAiModels();
    expect((await listAiModels()).map((model) => model.id)).toEqual(['a']);
    expect((await listAiModels({ refresh: true })).map((model) => model.id)).toEqual(['b']);
  });

  it('returns nothing without a key, without calling the provider', async () => {
    settings.key = null;
    expect(await listAiModels()).toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });

  it('uses the chosen model, or the newest listed when none is chosen', async () => {
    settings.model = 'chosen-model';
    expect(await resolveAiModel()).toBe('chosen-model');
    settings.model = '';
    list.mockReturnValue(page(['newest', 'older']));
    expect(await resolveAiModel()).toBe('newest');
  });
});
