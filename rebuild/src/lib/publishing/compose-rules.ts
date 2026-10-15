import type { PublishingTraits } from '@/platforms/module';

/** The platform-module facts the composer needs; passed to the browser as plain data. */
export type ComposeModule = {
  id: string;
  name: string;
  mark: { text: string; color: string };
  traits: PublishingTraits;
};
export type AttachmentFormat = PublishingTraits['formats'][number];

export const ALL_FORMATS: readonly AttachmentFormat[] = ['link', 'image', 'video'];

/** Modules that the chosen channels belong to, without repeats. */
export function modulesOf(providers: readonly (string | null)[], modules: readonly ComposeModule[]): ComposeModule[] {
  const ids = new Set(providers.filter((id): id is string => Boolean(id)));
  return modules.filter(module => ids.has(module.id));
}

/** The strictest text limit among the chosen platforms, never above the workspace limit. */
export function textLimit(selected: readonly ComposeModule[], workspaceMax: number): number {
  return selected.reduce((limit, module) => Math.min(limit, module.traits.maxTextLength), workspaceMax);
}

/** Formats every chosen platform accepts. With no channel chosen, everything is offered. */
export function allowedFormats(selected: readonly ComposeModule[]): AttachmentFormat[] {
  if (!selected.length) return [...ALL_FORMATS];
  return ALL_FORMATS.filter(format => selected.every(module => module.traits.formats.includes(format)));
}

/** A first comment is offered when every chosen platform can post one. */
export function firstCommentAllowed(selected: readonly ComposeModule[]): boolean {
  return selected.every(module => module.traits.firstComment);
}

export type CountStatus = { length: number; limit: number; remaining: number; over: boolean };
export function countStatus(text: string, limit: number): CountStatus {
  const length = [...text].length;
  return { length, limit, remaining: limit - length, over: length > limit };
}

/** Plain-language reason a chosen attachment cannot be sent to the chosen platforms, or null. */
export function formatProblem(format: AttachmentFormat | null, selected: readonly ComposeModule[]): string | null {
  if (!format) return null;
  const blockers = selected.filter(module => !module.traits.formats.includes(format));
  if (!blockers.length) return null;
  const label = format === 'link' ? 'a link' : format === 'image' ? 'an image' : 'a video';
  return `${blockers.map(module => module.name).join(' and ')} cannot publish ${label}. Remove it or change the channels.`;
}
