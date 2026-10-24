import { describe, expect, it } from 'vitest';
import { assessSpamRisk, formatOfAppPost, hourBucket, lengthBucket, linkKey, linksOf, parseOpenGraphHtml, predictEngagement, similarText, wordsOf, type PastPost } from '../src/modules/studio/content-tools/pure';
import { pickModel } from '../src/modules/studio/content-tools/server/media-ports';
import { AI_CONTENT_TOOLS_DEFAULTS, imagePolicySchema, outlookPolicySchema, toolsCopySchema, videoPolicySchema, voicePolicySchema } from '../src/modules/studio/config';
import { TOOLS_COPY, fill } from '../src/modules/studio/content-tools/copy';
import { decide, firstMeasure, learningLine, planCaptions, sumMeasures, tally } from '../src/modules/studio/caption-tests/pure';
import { CAPTION_TESTS_COPY } from '../src/modules/studio/caption-tests/copy';
import { captionTestsCopySchema, captionTestsPolicySchema, CAPTION_TESTS_DEFAULTS } from '../src/modules/studio/config';

const rules = AI_CONTENT_TOOLS_DEFAULTS.outlook;
const limits = { headScanBytes: 100_000, fieldMaxCharacters: 500 };

describe('Root defaults validate and carry both languages', () => {
  it('accepts every shipped default', () => {
    expect(imagePolicySchema.safeParse(AI_CONTENT_TOOLS_DEFAULTS.image).success).toBe(true);
    expect(voicePolicySchema.safeParse(AI_CONTENT_TOOLS_DEFAULTS.voice).success).toBe(true);
    expect(videoPolicySchema.safeParse(AI_CONTENT_TOOLS_DEFAULTS.video).success).toBe(true);
    expect(outlookPolicySchema.safeParse(rules).success).toBe(true);
    expect(toolsCopySchema.safeParse(TOOLS_COPY).success).toBe(true);
    expect(captionTestsPolicySchema.safeParse(CAPTION_TESTS_DEFAULTS).success).toBe(true);
    expect(captionTestsCopySchema.safeParse(CAPTION_TESTS_COPY).success).toBe(true);
  });
  it('keeps English and French catalogs in step', () => {
    expect(Object.keys(TOOLS_COPY.fr).sort()).toEqual(Object.keys(TOOLS_COPY.en).sort());
    expect(Object.keys(CAPTION_TESTS_COPY.fr).sort()).toEqual(Object.keys(CAPTION_TESTS_COPY.en).sort());
  });
  it('rejects a default size or voice that is not offered, and inconsistent boundaries', () => {
    expect(imagePolicySchema.safeParse({ ...AI_CONTENT_TOOLS_DEFAULTS.image, defaultSize: 'huge' }).success).toBe(false);
    expect(voicePolicySchema.safeParse({ ...AI_CONTENT_TOOLS_DEFAULTS.voice, defaultVoice: 'zzz' }).success).toBe(false);
    expect(outlookPolicySchema.safeParse({ ...rules, shortMaxLength: 500, mediumMaxLength: 400 }).success).toBe(false);
    expect(imagePolicySchema.safeParse({ ...AI_CONTENT_TOOLS_DEFAULTS.image, endpoint: 'http://insecure.example' }).success).toBe(false);
  });
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(fill('{a} and {b}', { a: 1 })).toBe('1 and {b}');
  });
});

describe('model choice', () => {
  const listed = [{ id: 'gpt-image-1', created: 10 }, { id: 'gpt-image-2', created: 20 }, { id: 'gpt-4o', created: 30 }, { id: 'veo-3.0-fast', created: 0 }, { id: 'veo-3.0', created: 0 }];
  it('uses the configured model as is', () => expect(pickModel('mine', listed, 'image')).toBe('mine'));
  it('picks the newest matching model', () => expect(pickModel('', listed, 'image')).toBe('gpt-image-2'));
  it('prefers the full video model over fast or lite, and falls back when only those exist', () => {
    expect(pickModel('', listed, 'veo', 'fast|lite')).toBe('veo-3.0');
    expect(pickModel('', [{ id: 'veo-3.0-fast', created: 0 }], 'veo', 'fast|lite')).toBe('veo-3.0-fast');
  });
  it('returns null when nothing matches', () => expect(pickModel('', listed, 'tts')).toBeNull());
});

describe('Open Graph parsing', () => {
  const html = `<html><head><title>Fallback &amp; title</title><meta property="og:title" content="Big &quot;news&quot;"><meta property="og:description" content="Line one
  two"><meta property="og:image" content="/img/a.png"><meta property="og:image" content="/img/b.png"><meta property="og:site_name" content="Example"></head><body><meta property="og:title" content="ignored"></body></html>`;
  it('reads title, description, first picture and site; resolves relative pictures', () => {
    const p = parseOpenGraphHtml(html, 'https://example.com/post', limits, new Date('2026-10-22T00:00:00Z'));
    expect(p).toMatchObject({ url: 'https://example.com/post', title: 'Big "news"', description: 'Line one two', imageUrl: 'https://example.com/img/a.png', siteName: 'Example', fetchedAt: '2026-10-22T00:00:00.000Z' });
  });
  it('falls back to the document title and refuses non-web picture schemes', () => {
    const p = parseOpenGraphHtml('<head><title>Plain</title><meta property="og:image" content="javascript:alert(1)"></head>', 'https://example.com', limits);
    expect(p.title).toBe('Plain'); expect(p.imageUrl).toBeNull();
  });
  it('bounds field length and strips control characters', () => {
    const p = parseOpenGraphHtml(`<head><meta property="og:title" content="${'x'.repeat(900)}\u0007"></head>`, 'https://e.com', { headScanBytes: 5000, fieldMaxCharacters: 40 });
    expect(p.title).toHaveLength(40);
  });
});

describe('engagement outlook', () => {
  const post = (over: Partial<PastPost>): PastPost => ({ format: 'photo', length: 50, hour: 9, weekday: 2, interactions: 10, ...over });
  it('says nothing without enough history', () => {
    expect(predictEngagement(Array.from({ length: 9 }, () => post({})), { format: 'photo', length: 50, hour: null, weekday: null }, rules)).toMatchObject({ outlook: 'unknown', basis: 9 });
  });
  it('rates a draft above the channel usual when its factors did better', () => {
    const history = [...Array.from({ length: 6 }, () => post({ format: 'photo', interactions: 40 })), ...Array.from({ length: 6 }, () => post({ format: 'text', interactions: 10 }))];
    const result = predictEngagement(history, { format: 'photo', length: 50, hour: null, weekday: null }, rules);
    expect(result.outlook).toBe('above'); expect(result.reasons[0]).toMatchObject({ factor: 'format', value: 'photo', posts: 6 });
  });
  it('rates below, and ignores posts whose format is unknown for the format factor', () => {
    const history = [...Array.from({ length: 6 }, () => post({ format: 'text', interactions: 2 })), ...Array.from({ length: 6 }, () => post({ format: null, interactions: 20 }))];
    const result = predictEngagement(history, { format: 'text', length: 50, hour: null, weekday: null }, rules);
    expect(result.reasons.find(r => r.factor === 'format')?.posts).toBe(6); expect(result.outlook).not.toBe('above');
  });
  it('buckets length and hour by Root boundaries', () => {
    expect(lengthBucket(79, rules)).toBe('short'); expect(lengthBucket(80, rules)).toBe('medium'); expect(lengthBucket(400, rules)).toBe('long');
    expect([5, 6, 12, 18].map(h => hourBucket(h, rules))).toEqual(['night', 'morning', 'afternoon', 'evening']);
  });
  it('classifies an application post by what it carries', () => {
    expect(formatOfAppPost([{ kind: 'image' }, { kind: 'video' }], null)).toBe('video');
    expect(formatOfAppPost([{ kind: 'image' }], null)).toBe('photo');
    expect(formatOfAppPost([], 'https://x.test')).toBe('link'); expect(formatOfAppPost([], null)).toBe('text');
  });
});

describe('spam risk', () => {
  const spam = { pagesThreshold: 3, similarity: 0.8, minWords: 5 };
  const ch = (id: string, network = 'facebook') => ({ id, network });
  it('normalises links so tracking tags do not hide a repeat', () => {
    expect(linkKey('https://www.Example.com/a/?utm=1#x')).toBe('example.com/a');
    expect([...linksOf('See https://example.com/a?x=1 now', 'https://example.com/b')].sort()).toEqual(['example.com/a', 'example.com/b']);
  });
  it('compares near-identical text only when long enough', () => {
    expect(similarText(wordsOf('one two three four five six'), wordsOf('one two three four five six'), 5, 0.8)).toBe(true);
    expect(similarText(wordsOf('hi there'), wordsOf('hi there'), 5, 0.8)).toBe(false);
  });
  it('flags the same link reaching too many channels of one network', () => {
    const risk = assessSpamRisk({ message: 'Read https://example.com/a', link: null, own: [ch('1'), ch('2')], gapMinutes: 20, nearby: [{ message: 'https://example.com/a?utm=x', link: null, channels: [ch('3')] }] }, spam);
    expect(risk).toEqual({ pages: 3, network: 'facebook', ownPages: 2, otherPosts: 1, gapMinutes: 20 });
  });
  it('does not flag below the threshold, across networks, or when the guard is off', () => {
    const base = { message: 'Read https://example.com/a', link: null, own: [ch('1')], nearby: [{ message: 'https://example.com/a', link: null, channels: [ch('2', 'other')] }] };
    expect(assessSpamRisk({ ...base, gapMinutes: 20 }, spam)).toBeNull();
    expect(assessSpamRisk({ ...base, own: [ch('1'), ch('2'), ch('3')], gapMinutes: 0 }, spam)).toBeNull();
  });
});

describe('caption test figures', () => {
  it('shares channels out between captions, or rotates days when channels are few', () => {
    expect(planCaptions(['a', 'b', 'c', 'd'], 2)).toEqual([{ targetIds: ['a', 'c'], dayOffset: 0 }, { targetIds: ['b', 'd'], dayOffset: 0 }]);
    expect(planCaptions(['a'], 3)).toEqual([{ targetIds: ['a'], dayOffset: 0 }, { targetIds: ['a'], dayOffset: 1 }, { targetIds: ['a'], dayOffset: 2 }]);
  });
  it('reads views from the first stored measure and sums engagements; missing stays unknown', () => {
    const measures = [{ key: 'impressions', value: 1000 }, { key: 'reactions', value: 30 }, { key: 'comments', value: null }, { key: 'shares', value: 5 }];
    expect(firstMeasure(measures, ['reach', 'impressions'])).toBe(1000);
    expect(sumMeasures(measures, ['reactions', 'comments', 'shares', 'clicks'])).toBe(35);
    expect(sumMeasures(measures, ['clicks'])).toBeNull();
  });
  it('sums per caption and leaves a caption with no measured post unknown', () => {
    const results = tally([{ label: 'A', views: 100, engagements: 10 }, { label: 'A', views: 100, engagements: 20 }, { label: 'B', views: null, engagements: null }]);
    expect(results).toEqual([{ label: 'A', views: 200, engagements: 30, rate: 0.15 }, { label: 'B', views: null, engagements: null, rate: null }]);
  });
  it('names a winner only when every caption had enough views', () => {
    const r = (label: string, views: number | null, engagements: number | null) => ({ label, views, engagements, rate: views ? (engagements ?? 0) / views : null });
    expect(decide([r('A', 1000, 100), r('B', 1000, 50)], 500)).toMatchObject({ status: 'decided', winnerLabel: 'A', lift: 100 });
    expect(decide([r('A', 1000, 100), r('B', 100, 50)], 500)).toMatchObject({ status: 'inconclusive', reason: 'not_enough_views' });
    expect(decide([r('A', null, null), r('B', null, null)], 500)).toMatchObject({ reason: 'no_insights' });
    expect(decide([r('A', 1000, 50), r('B', 1000, 50)], 500)).toMatchObject({ reason: 'tie' });
    expect(decide([r('A', 1000, 50)], 500)).toMatchObject({ reason: 'no_insights' });
  });
  it('writes the learning sentence in the requested language, clipped', () => {
    expect(learningLine(CAPTION_TESTS_COPY.en, 'Win', 'Lose', 50.4, 140)).toBe('A caption test preferred “Win” over “Lose” (50% more engagement per view).');
    expect(learningLine(CAPTION_TESTS_COPY.fr, 'Gagne', 'Perd', null, 140)).toBe('Un test de légendes a préféré « Gagne » à « Perd ».');
    expect(learningLine(CAPTION_TESTS_COPY.en, 'x'.repeat(300), 'y', null, 20)).toContain('x'.repeat(19) + '…');
  });
});
