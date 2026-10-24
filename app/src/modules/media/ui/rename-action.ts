'use server';

import { requireViewer } from '@/server/context';
import { renameAsset } from '../server/library';
import { MEDIA_FEATURE_ID } from '../manifest';
import { operationFailure } from '@/lib/operation-error';
import { mediaMessage } from '../server/messages';

export async function renameMediaAction(input: unknown) {
  try {
    const viewer = await requireViewer({ feature: MEDIA_FEATURE_ID, channelScoped: true, write: true });
    return await renameAsset({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, input);
  } catch (error) {
    const failure = operationFailure(error, 'The media operation could not be confirmed. Refresh the library before trying again.');
    return { error: await mediaMessage(failure.error) };
  }
}
