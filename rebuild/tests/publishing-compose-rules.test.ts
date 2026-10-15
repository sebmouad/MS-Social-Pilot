import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPostForEditing, prisma } from '../src/server/data';
import { allowedFormats, countStatus, firstCommentAllowed, formatProblem, modulesOf, textLimit, type ComposeModule } from '../src/lib/publishing/compose-rules';
import { composeErrorMessage } from '../src/lib/publishing/compose-errors';
import { PLATFORM_MODULES } from '../src/platforms';

const wide: ComposeModule = { id: 'a', name: 'Alpha', mark: { text: 'a', color: '#111111' }, traits: { maxTextLength: 5000, formats: ['link', 'image', 'video'], firstComment: true } };
const narrow: ComposeModule = { id: 'b', name: 'Beta', mark: { text: 'b', color: '#222222' }, traits: { maxTextLength: 280, formats: ['image'], firstComment: false } };

describe('composer rules from platform modules', () => {
  it('uses the strictest limit of the selected platforms, never above the workspace limit', () => {
    expect(textLimit([], 10000)).toBe(10000);
    expect(textLimit([wide], 10000)).toBe(5000);
    expect(textLimit([wide, narrow], 10000)).toBe(280);
    expect(textLimit([wide], 1000)).toBe(1000);
  });

  it('offers only formats every selected platform supports', () => {
    expect(allowedFormats([])).toEqual(['link', 'image', 'video']);
    expect(allowedFormats([wide])).toEqual(['link', 'image', 'video']);
    expect(allowedFormats([wide, narrow])).toEqual(['image']);
    expect(formatProblem('video', [wide, narrow])).toMatch(/Beta cannot publish a video/);
    expect(formatProblem('image', [wide, narrow])).toBeNull();
    expect(formatProblem(null, [wide, narrow])).toBeNull();
  });

  it('offers a first comment only when every selected platform can post one', () => {
    expect(firstCommentAllowed([wide])).toBe(true);
    expect(firstCommentAllowed([wide, narrow])).toBe(false);
  });

  it('counts characters by what a person sees and reports the overflow', () => {
    expect(countStatus('héllo', 10)).toMatchObject({ length: 5, remaining: 5, over: false });
    expect(countStatus('a😀b', 3)).toMatchObject({ length: 3, over: false });
    expect(countStatus('abcdef', 4)).toMatchObject({ remaining: -2, over: true });
  });

  it('maps connected providers to their modules, ignoring unknown and missing ones', () => {
    expect(modulesOf(['a', null, 'a', 'zzz'], [wide, narrow]).map(module => module.id)).toEqual(['a']);
  });

  it('every installed platform that can publish declares its post rules', () => {
    for (const module of PLATFORM_MODULES) {
      if (module.capabilities.publishing !== 'supported') continue;
      const traits = (module as { publishing?: ComposeModule['traits'] }).publishing;
      expect(traits, `${module.id} needs publishing traits`).toBeDefined();
      expect(traits!.maxTextLength).toBeGreaterThan(0);
      expect(traits!.formats.length).toBeGreaterThan(0);
    }
  });
});

describe('composer error messages', () => {
  it('passes people-written lifecycle messages through and hides internals', () => {
    expect(composeErrorMessage(new Error('Choose a future publishing time.'))).toBe('Choose a future publishing time.');
    expect(composeErrorMessage(new Error('Invalid `prisma.post.create()` invocation: Null constraint violation'))).toMatch(/could not be saved/);
    expect(composeErrorMessage(new Error('x'.repeat(300)))).toMatch(/could not be saved/);
    expect(composeErrorMessage('boom')).toMatch(/could not be saved/);
  });
});

describe('getPostForEditing', () => {
  afterEach(() => vi.restoreAllMocks());
  const draft = { id: 'p1', message: 'Hi', firstComment: null, link: null, media: [], status: 'draft', authorId: 'u1', targets: [{ targetId: 't1', remotePostId: null }] };
  const find = (value: unknown) => vi.spyOn(prisma.post, 'findFirst').mockResolvedValue(value as never);

  it('returns an editable draft inside the workspace and asks the database for drafts only', async () => {
    const spy = find(draft);
    expect(await getPostForEditing('w1', 'p1', null, 'u1', 'editor')).toMatchObject({ id: 'p1' });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'p1', workspaceId: 'w1', status: { in: ['draft', 'rejected'] }, publishedAt: null } }));
  });

  it('refuses another author for contributors, posts with live copies, and channels outside the scope', async () => {
    find({ ...draft, authorId: 'u2' });
    expect(await getPostForEditing('w1', 'p1', null, 'u1', 'contributor')).toBeNull();
    expect(await getPostForEditing('w1', 'p1', null, 'u1', 'editor')).not.toBeNull();
    find({ ...draft, targets: [{ targetId: 't1', remotePostId: 'remote' }] });
    expect(await getPostForEditing('w1', 'p1', null, 'u1', 'editor')).toBeNull();
    find(draft);
    expect(await getPostForEditing('w1', 'p1', ['t2'], 'u1', 'editor')).toBeNull();
    expect(await getPostForEditing('w1', 'p1', ['t1'], 'u1', 'editor')).not.toBeNull();
    find(null);
    expect(await getPostForEditing('w1', 'missing', null, 'u1', 'owner')).toBeNull();
  });
});
