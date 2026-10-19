/**
 * Capability descriptors for native Facebook formats. RESERVED: not registered in
 * the manifest. The lead may advertise an entry only after the executor is wired to
 * a real transport, a durable attempt store, authorization, UI/API/MCP and live proof.
 */
export interface FacebookNativeCapability {
  id: 'video' | 'reel' | 'story_photo' | 'story_video';
  label: string;
  targetKinds: readonly string[];
  nativeSchedule: boolean;
  mediaKind: 'video' | 'image';
  /** Provider-side follow-ups implemented in formats/status.ts (still unwired). */
  firstComment: boolean;
  remoteDelete: boolean;
  statusReadback: boolean;
  wired: false;
}
/** Group posting is deliberately NOT a native format here: it is rejected by planning (Page-only) and never advertised. */
export const FACEBOOK_NATIVE_CAPABILITIES: readonly FacebookNativeCapability[] = Object.freeze([
  { id: 'video', label: 'Video post', targetKinds: ['page'], nativeSchedule: true, mediaKind: 'video', firstComment: true, remoteDelete: true, statusReadback: true, wired: false },
  { id: 'reel', label: 'Reel', targetKinds: ['page'], nativeSchedule: false, mediaKind: 'video', firstComment: true, remoteDelete: true, statusReadback: true, wired: false },
  { id: 'story_photo', label: 'Photo Story', targetKinds: ['page'], nativeSchedule: false, mediaKind: 'image', firstComment: false, remoteDelete: false, statusReadback: false, wired: false },
  { id: 'story_video', label: 'Video Story', targetKinds: ['page'], nativeSchedule: false, mediaKind: 'video', firstComment: false, remoteDelete: false, statusReadback: true, wired: false },
] as const);
