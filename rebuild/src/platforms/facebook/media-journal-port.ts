/** Facebook-owned persistence boundary for unpublished multi-photo uploads.
 * Implementations must commit each transition before the engine continues.
 */
export interface FacebookMediaJournal {
  /** Photo positions are one-based and must be committed before the upload. */
  beginPhoto(ordinal: number): Promise<void>;
  recordPhoto(ordinal: number, remoteId: string): Promise<void>;
  rejectPhoto(ordinal: number): Promise<void>;
  beginFeed(photoIds: readonly string[]): Promise<void>;
  recordFeed(remoteId: string): Promise<void>;
  rejectFeed(): Promise<void>;
}

/** The caller scopes this journal to one durable publication operation and Page. */
export type FacebookMediaJournalFactory = (operationId: string, remoteTargetId: string) => FacebookMediaJournal;
