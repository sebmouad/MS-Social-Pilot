/** The workspace's brand voice with its list of words to avoid, as the AI is told it. */
export function voiceWithAvoid(voice: string | null | undefined, avoid: string | null | undefined): string | null {
  const parts = [voice?.trim(), avoid?.trim() ? `Never use these words or phrases: ${avoid.trim()}` : null].filter(Boolean);
  return parts.length ? parts.join('\n') : null;
}
