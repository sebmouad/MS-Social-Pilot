import { expect, it, vi } from 'vitest';
import { OperationError, operationFailure } from '../src/lib/operation-error';
import { publishingErrorCopy, publishingErrorCopySchema, publishingErrorText, PublishingOperationError, publishingErrorClassificationMessage } from '../src/modules/publishing/error-catalog';
const mock = vi.hoisted(() => ({ runtime: vi.fn(), user: vi.fn() }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mock.runtime }));
vi.mock('../src/server/data', () => ({ prisma: { user: { findUnique: mock.user } } }));
vi.mock('../src/server/entitlements', () => ({ canUseFeature: vi.fn(), loadEntitlements: vi.fn() }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: vi.fn() }));
vi.mock('../src/server/data-control/guard', () => ({ assertWorkspaceNotPurging: vi.fn() }));
import { authorizePublishing } from '../src/modules/publishing/server/access';

it('validates complete English/French copy and preserves dynamic placeholders', () => {
  expect(publishingErrorCopySchema.safeParse(publishingErrorCopy).success).toBe(true);
  expect(publishingErrorCopySchema.parse(publishingErrorCopy)).toEqual(publishingErrorCopy);
  const copy = structuredClone(publishingErrorCopy);
  copy.postTextMustBeBetween1AndValue0Characters.fr = 'Texte trop long';
  expect(publishingErrorCopySchema.safeParse(copy).success).toBe(false);
});
it('keeps authorization codes and canonical classification when Root changes wording', async () => {
  const copy = structuredClone(publishingErrorCopy);
  copy.signInWithAnActiveAccountToManagePosts.en = 'Please sign in again.';
  mock.runtime.mockResolvedValue(copy);
  mock.user.mockResolvedValue(null);
  const error = await authorizePublishing({ userId: 'u', workspaceId: 'w' }).catch(value => value);
  expect(error).toBeInstanceOf(OperationError);
  expect(error).toMatchObject({ code: 'unauthorized', message: 'Please sign in again.' });
  expect(publishingErrorClassificationMessage(error)).toBe(publishingErrorCopy.signInWithAnActiveAccountToManagePosts.en);
  expect(operationFailure(error, 'fallback')).toEqual({ error: 'Please sign in again.', code: 'unauthorized', status: 401 });
  expect(JSON.stringify(error)).not.toContain('defaultMessage');
});
it('renders French and original dynamic null interpolation while keeping classification stable', () => {
  const text = publishingErrorText(publishingErrorCopy, 'fr-FR');
  const error = new PublishingOperationError('invalid_request', 'chooseUpToValue0SupportedMediaAttachments', { value0: null }, text);
  expect(error.message).toContain('null');
  expect(publishingErrorClassificationMessage(error)).toBe('Choose up to null supported media attachments.');
});
