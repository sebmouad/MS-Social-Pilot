import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ prisma: { $queryRaw: vi.fn() }, batch: vi.fn(), config: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: mocks.prisma }));
vi.mock('../src/server/config/store', () => ({ runtimeConfigBatch: mocks.batch, runtimeConfig: mocks.config }));

import { OPERATOR_DEFAULTS, SITE_CONTENT_DEFAULTS, fillText, frenchTypography, operatorSchema, parseBlocks, parseInline, resolveDataDeletionResults, resolveLegalValues, siteContentSchema, siteLocale } from '../src/modules/history/public/content';
import { HISTORY_COPY, historyActionLabelsSchema, historyCopySchema, HISTORY_ACTION_LABELS, actionLabel, humanizeAction } from '../src/modules/history/copy';
import { ROOT_CHANGELOG_COPY, rootChangelogCopySchema } from '../src/modules/history/root-copy';
import { HISTORY_CONFIG } from '../src/modules/history/config';
import { readSystemHealth } from '../src/modules/history/server/health';
import { loadSiteContent } from '../src/modules/history/server/site';

describe('Root-editable public content', () => {
  it('ships valid English and French defaults with matching structure', () => {
    expect(siteContentSchema.safeParse(SITE_CONTENT_DEFAULTS).success).toBe(true);
    const { en, fr } = SITE_CONTENT_DEFAULTS;
    for (const page of ['privacy', 'terms', 'dataDeletion'] as const) expect(fr[page].sections).toHaveLength(en[page].sections.length);
    expect(fr.help.items).toHaveLength(en.help.items.length);
    expect(Object.keys(fr.pricing.featureLabels).sort()).toEqual(Object.keys(en.pricing.featureLabels).sort());
  });
  it('rejects unknown keys so a typo in Root cannot silently hide a page', () => {
    expect(siteContentSchema.safeParse({ ...SITE_CONTENT_DEFAULTS, de: SITE_CONTENT_DEFAULTS.en }).success).toBe(false);
    expect(operatorSchema.safeParse({ ...OPERATOR_DEFAULTS, email: 'not-an-email' }).success).toBe(false);
    expect(operatorSchema.safeParse({ ...OPERATOR_DEFAULTS, email: 'ops@example.test' }).success).toBe(true);
  });
  it('turns only paragraphs, lists and safe links into structure — never markup', () => {
    expect(parseBlocks('One\ntwo\n\n- a\n- b')).toEqual([{ kind: 'p', text: 'One two' }, { kind: 'ul', items: ['a', 'b'] }]);
    const parts = parseInline('[ok](/privacy-policy) [mail](mailto:a@b.test) [bad](javascript:alert(1)) [ext](https://evil.test) [proto](//evil.test) <b>x</b>');
    expect(parts.filter(part => part.kind === 'link').map(part => (part as { href: string }).href)).toEqual(['/privacy-policy', 'mailto:a@b.test']);
    expect(parts.map(part => part.kind === 'text' ? part.text : '').join('')).toContain('<b>x</b>');
  });
  it('fills operator placeholders and falls back to neutral phrases when a detail is blank', () => {
    const t = SITE_CONTENT_DEFAULTS.en;
    const blank = resolveLegalValues(OPERATOR_DEFAULTS, '', t.fallbacks);
    expect(blank).toMatchObject({ operatorName: t.fallbacks.operatorName, appUrlSuffix: '', controllerPlace: '', governingLaw: t.fallbacks.governingLaw });
    const set = resolveLegalValues({ ...OPERATOR_DEFAULTS, name: 'Acme', country: 'France', address: '1 Rue X', email: 'ops@example.test' }, 'https://app.example.test', t.fallbacks);
    expect(set).toMatchObject({ operatorName: 'Acme', appUrlSuffix: ' (https://app.example.test)', controllerPlace: ', 1 Rue X, France', operatorEmail: '[ops@example.test](mailto:ops@example.test)' });
    expect(fillText('{operatorName} / {typo}', set)).toBe('Acme / {typo}');
  });
  it('picks French only for French browsers', () => {
    expect(siteLocale('fr-CA,fr;q=0.9')).toBe('fr'); expect(siteLocale('en-US')).toBe('en'); expect(siteLocale(null)).toBe('en');
  });
});

describe('Root setting declarations', () => {
  it('every default validates against its own schema and none is a secret', () => {
    for (const item of HISTORY_CONFIG) {
      expect(item.schema.safeParse(item.defaultValue).success, item.key).toBe(true);
      expect(item.kind).not.toBe('secret');
    }
    expect(historyCopySchema.safeParse(HISTORY_COPY).success).toBe(true);
    expect(rootChangelogCopySchema.safeParse(ROOT_CHANGELOG_COPY).success).toBe(true);
    expect(historyActionLabelsSchema.safeParse(HISTORY_ACTION_LABELS).success).toBe(true);
  });
  it('English and French catalogs carry the same placeholders', () => {
    const holes = (value: string) => (value.match(/\{\w+\}/g) ?? []).sort().join();
    for (const key of Object.keys(HISTORY_COPY.en) as Array<keyof typeof HISTORY_COPY.en>) expect(holes(HISTORY_COPY.fr[key]), key).toBe(holes(HISTORY_COPY.en[key]));
  });
  it('labels known actions in both languages and makes words from unknown codes', () => {
    expect(actionLabel('tasks.created', 'fr', HISTORY_ACTION_LABELS)).toBe('A créé une tâche');
    expect(actionLabel('inbox.conversation_resolved', 'en', HISTORY_ACTION_LABELS)).toBe('Resolved a conversation');
    expect(actionLabel('inbox.comment_reopened', 'fr', HISTORY_ACTION_LABELS)).toBe('A rouvert un commentaire');
    expect(actionLabel('inbox.review_resolved', 'fr', HISTORY_ACTION_LABELS)).toBe('A résolu un avis');
    expect(actionLabel('media.upload_failed', 'en', {})).toBe('Media: upload failed');
    expect(humanizeAction('ping')).toBe('Ping');
  });
});

describe('health probe facts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.batch.mockResolvedValue({ 'health.databaseTimeoutMs': 200, 'root.workerStaleSeconds': 300 });
  });
  it('is healthy with a fresh worker heartbeat', async () => {
    const now = Date.now();
    mocks.prisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => strings.join('?').includes('worker_heartbeats') ? [{ seenAt: new Date(now - 10_000) }] : [{ '?column?': 1 }]);
    await expect(readSystemHealth(now)).resolves.toEqual({ database: true, worker: { status: 'ok', lastBeatSeconds: 10 } });
  });
  it('reports a stale, missing or unreadable worker without failing the verdict', async () => {
    const now = Date.now();
    mocks.prisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => strings.join('?').includes('worker_heartbeats') ? [{ seenAt: new Date(now - 900_000) }] : [1]);
    expect((await readSystemHealth(now)).worker.status).toBe('stale');
    mocks.prisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => strings.join('?').includes('worker_heartbeats') ? [] : [1]);
    expect((await readSystemHealth(now)).worker.status).toBe('never');
    mocks.prisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => { if (strings.join('?').includes('worker_heartbeats')) throw new Error('no table'); return [1]; });
    expect(await readSystemHealth(now)).toMatchObject({ database: true, worker: { status: 'unknown' } });
  });
  it('is unavailable when the database fails or does not answer in time', async () => {
    mocks.prisma.$queryRaw.mockRejectedValue(new Error('down'));
    expect((await readSystemHealth()).database).toBe(false);
    mocks.prisma.$queryRaw.mockImplementation(() => new Promise(() => undefined));
    expect(await readSystemHealth()).toMatchObject({ database: false, worker: { status: 'unknown' } });
  });
});

describe('data-deletion outcome sentences', () => {
  const holes = (value: string) => (value.match(/\{\w+\}/g) ?? []).sort().join();
  const keys = ['resultCompletedOne', 'resultCompletedMany', 'resultUnknown', 'resultInvalid'] as const;
  it('ships English and French outcome sentences with the same placeholders', () => {
    for (const key of keys) {
      expect(SITE_CONTENT_DEFAULTS.en.dataDeletion[key]?.trim(), `en.${key}`).not.toBe('');
      expect(SITE_CONTENT_DEFAULTS.fr.dataDeletion[key]?.trim(), `fr.${key}`).not.toBe('');
      expect(holes(SITE_CONTENT_DEFAULTS.fr.dataDeletion[key]!), key).toBe(holes(SITE_CONTENT_DEFAULTS.en.dataDeletion[key]!));
    }
    expect(holes(SITE_CONTENT_DEFAULTS.en.dataDeletion.resultCompletedOne!)).toBe('{count},{when}');
    expect(holes(SITE_CONTENT_DEFAULTS.en.dataDeletion.resultCompletedMany!)).toBe('{count},{when}');
  });
  it('keeps saved catalogs from before the outcome sentences valid, filling each gap from the shipped locale text', () => {
    const legacy = structuredClone(SITE_CONTENT_DEFAULTS);
    for (const locale of ['en', 'fr'] as const) for (const key of keys) delete legacy[locale].dataDeletion[key];
    expect(siteContentSchema.safeParse(legacy).success).toBe(true);
    const shipped = (locale: 'en' | 'fr') => {
      const { resultCompletedOne, resultCompletedMany, resultUnknown, resultInvalid } = SITE_CONTENT_DEFAULTS[locale].dataDeletion;
      return { resultCompletedOne: resultCompletedOne!, resultCompletedMany: resultCompletedMany!, resultUnknown: resultUnknown!, resultInvalid: resultInvalid! };
    };
    expect(resolveDataDeletionResults(legacy.en.dataDeletion, 'en')).toEqual(shipped('en'));
    expect(resolveDataDeletionResults(legacy.fr.dataDeletion, 'fr')).toEqual(frenchTypography(shipped('fr')));
  });
  it('prefers Root-saved outcome sentences and rejects completed templates that drop a placeholder', () => {
    const edited = { ...resolveDataDeletionResults(SITE_CONTENT_DEFAULTS.en.dataDeletion, 'en'), resultUnknown: 'Custom unknown.' };
    expect(resolveDataDeletionResults(edited, 'en')).toMatchObject({ resultUnknown: 'Custom unknown.' });
    const saved = (key: (typeof keys)[number], template: string) => siteContentSchema.safeParse({ ...SITE_CONTENT_DEFAULTS, en: { ...SITE_CONTENT_DEFAULTS.en, dataDeletion: { ...SITE_CONTENT_DEFAULTS.en.dataDeletion, [key]: template } } }).success;
    expect(saved('resultCompletedOne', 'Done on {when}. No count here.')).toBe(false);
    expect(saved('resultCompletedMany', '{count} removed, no date.')).toBe(false);
    expect(saved('resultCompletedOne', '{count} connection removed on {when}.')).toBe(true);
    expect(saved('resultUnknown', 'Custom unknown.')).toBe(true);
  });
});

describe('deletion lookup content loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('serves Root-edited outcome sentences with French typography applied', async () => {
    const edited = structuredClone(SITE_CONTENT_DEFAULTS);
    edited.fr.dataDeletion.resultUnknown = 'Introuvable : réessayez.';
    edited.en.dataDeletion.resultInvalid = 'Edited invalid.';
    mocks.config.mockImplementation(async (key: string) => {
      if (key === 'public.content') return edited;
      throw new Error(`unexpected ${key}`);
    });
    // The space before ":" below is the narrow no-break space French typography inserts.
    expect((await loadSiteContent('fr')).dataDeletion.resultUnknown).toBe('Introuvable : réessayez.');
    expect((await loadSiteContent('en')).dataDeletion.resultInvalid).toBe('Edited invalid.');
  });
  it('falls back to the shipped catalog when the saved value is invalid', async () => {
    mocks.config.mockResolvedValue({ nope: true });
    const en = await loadSiteContent('en');
    expect(en.dataDeletion.resultInvalid).toBe(SITE_CONTENT_DEFAULTS.en.dataDeletion.resultInvalid);
  });
});
