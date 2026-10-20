import { IconChevronRight } from "@tabler/icons-react";

export type Crumb = { label: string; href?: string };

/** Trail ending in the current page (no link, aria-current). Long labels truncate instead of wrapping. */
export function Breadcrumbs({ items, label = "Breadcrumb" }: { items: Crumb[]; label?: string }) {
  return <nav aria-label={label} className="ui-breadcrumbs"><ol>
    {items.map((item, index) => {
      const last = index === items.length - 1;
      return <li key={`${index}-${item.label}`}>
        {item.href && !last ? <a href={item.href}>{item.label}</a> : <span aria-current={last ? "page" : undefined}>{item.label}</span>}
        {!last && <IconChevronRight size={14} stroke={1.75} aria-hidden="true" />}
      </li>;
    })}
  </ol></nav>;
}
