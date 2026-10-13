/**
 * A small coloured mark for each network, so a destination's network reads at
 * a glance in pickers and lists. Plain letters in each network's colour — not
 * the networks' logos.
 */
const MARKS: Record<string, { text: string; background: string; color?: string }> = {
  page: { text: 'f', background: '#1877f2' },
  group: { text: 'f', background: '#1877f2' },
  instagram: { text: 'IG', background: 'linear-gradient(135deg,#f58529,#dd2a7b 50%,#8134af)' },
  bluesky: { text: 'B', background: '#1185fe' },
  mastodon: { text: 'M', background: '#6364ff' },
  linkedin: { text: 'in', background: '#0a66c2' },
  threads: { text: '@', background: '#101010' },
  x: { text: 'X', background: '#0f1419' },
  pinterest: { text: 'P', background: '#e60023' },
  youtube: { text: '▶', background: '#ff0000' },
  tiktok: { text: '♪', background: '#010101' },
};

export function NetworkMark({ network, size = 20, className = '' }: { network: string; size?: number; className?: string }) {
  const mark = MARKS[network] ?? { text: '?', background: '#65676b' };
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-[28%] font-bold leading-none text-white ${className}`}
      style={{ width: size, height: size, background: mark.background, fontSize: Math.round(size * (mark.text.length > 1 ? 0.4 : 0.52)) }}
    >
      {mark.text}
    </span>
  );
}
