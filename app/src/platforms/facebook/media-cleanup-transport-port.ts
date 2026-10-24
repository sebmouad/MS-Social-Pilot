/** Internal only: current Root policy and credentials are checked before a cleanup intent. */
export interface FacebookMediaDeletionBinding {
  workspaceId: string;
  targetId: string;
  remoteTargetId: string;
  remotePhotoId: string;
}
export type FacebookMediaDeletion = (signal: AbortSignal) => Promise<'confirmed' | 'rejected' | 'uncertain'>;
