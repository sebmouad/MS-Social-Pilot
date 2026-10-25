"use client";
import { useState, type ReactNode } from "react";

/** Stable 1..8 slot (matches --chart-1..8) for a name, so the same person always gets the same color. */
export function avatarSlot(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index++) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  return (hash % 8) + 1;
}

/** Up to two initials: first letters of the first and last words; one word gives one letter. */
export function avatarInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letter = (word: string) => Array.from(word)[0]!.toLocaleUpperCase();
  return words.length === 1 ? letter(words[0]!) : letter(words[0]!) + letter(words[words.length - 1]!);
}

type AvatarProps = {
  /** Person or channel name: source of the initials, the color and the accessible name. */
  name: string;
  src?: string | null;
  size?: "sm" | "md" | "lg";
  /** Hide from assistive technology when the name is printed right beside the avatar. */
  decorative?: boolean;
  className?: string;
};

/** Round image with an initials fallback colored by a stable hash of the name. */
export function Avatar({ name, src, size = "md", decorative = false, className = "" }: AvatarProps) {
  // A stored picture URL can expire (signed CDN links); a failed image falls back to the initials.
  const [failed, setFailed] = useState<string | null>(null);
  return <span className={`ui-avatar ui-avatar--${size} ${className}`.trim()} data-slot={avatarSlot(name)} role={decorative ? undefined : "img"} aria-label={decorative ? undefined : name} aria-hidden={decorative || undefined}>
    {src && failed !== src
      // eslint-disable-next-line @next/next/no-img-element -- avatar sources are arbitrary authorized URLs
      ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(src)} />
      : <span aria-hidden="true">{avatarInitials(name)}</span>}
  </span>;
}

type AvatarStackProps = {
  people: Array<{ name: string; src?: string | null }>;
  /** Avatars shown before the "+N" counter. */
  max?: number;
  size?: "sm" | "md" | "lg";
  /** Accessible summary, for example "Assigned to Sara, Omar and 2 more". */
  label?: string;
  /** Counter text; defaults to "+N". */
  overflowLabel?: (hidden: number) => ReactNode;
};

/** Overlapping avatars with a "+N" counter for the rest. */
export function AvatarStack({ people, max = 4, size = "sm", label, overflowLabel = hidden => `+${hidden}` }: AvatarStackProps) {
  const shown = people.slice(0, Math.max(1, max));
  const hidden = people.length - shown.length;
  const summary = label ?? people.map(person => person.name).join(", ");
  return <span className="ui-avatar-stack" role="group" aria-label={summary}>
    {shown.map((person, index) => <Avatar key={`${person.name}-${index}`} name={person.name} src={person.src} size={size} decorative />)}
    {hidden > 0 && <span className={`ui-avatar ui-avatar--${size} ui-avatar--more`} aria-hidden="true">{overflowLabel(hidden)}</span>}
  </span>;
}
