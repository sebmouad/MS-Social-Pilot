import { paletteOf } from '@/lib/palette';

/** A post's labels as small coloured chips. */
export function LabelChips({ labels, size = 'sm' }: { labels: Array<{ id?: string; name: string; color: string }>; size?: 'xs' | 'sm' }) {
  if (labels.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {labels.map((label) => (
        <li
          key={label.id ?? label.name}
          className={`inline-flex items-center gap-1 rounded-full ring-1 ring-inset ${paletteOf(label.color).chip} ${
            size === 'xs' ? 'px-1.5 py-px text-[11px]' : 'px-2 py-0.5 text-xs'
          } font-semibold`}
        >
          <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${paletteOf(label.color).dot}`} />
          {label.name}
        </li>
      ))}
    </ul>
  );
}
