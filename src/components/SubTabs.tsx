import Link from 'next/link';

/**
 * Views of one screen, as a segmented row under its title: a sidebar entry
 * stays one place, and its closely related screens sit one click away.
 */
export function SubTabs({ items, current, label }: { items: Array<{ href: string; label: string }>; current: string; label: string }) {
  return (
    <nav className="segmented" aria-label={label}>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.href === current ? 'page' : undefined}
          className={`segmented-item ${item.href === current ? 'segmented-item-active' : ''}`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
