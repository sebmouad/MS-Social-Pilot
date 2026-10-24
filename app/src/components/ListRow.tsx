import type { ReactNode } from "react";

type ListRowProps = {
  /** Thumbnail, avatar stack or glyph. */
  leading?: ReactNode;
  title: ReactNode;
  /** One meta line: channel avatars · status chip · time. */
  meta?: ReactNode;
  /** Menu or chevron aligned to the end. */
  trailing?: ReactNode;
  /** Makes the whole row a link. Keep trailing controls outside it by leaving this unset and linking the title yourself. */
  href?: string;
  selected?: boolean;
  className?: string;
};

/** 64–72 px list row: thumbnail, two-line title, one meta line and a trailing control. Used for phone lists and short lists such as Coming up. */
export function ListRow({ leading, title, meta, trailing, href, selected = false, className = "" }: ListRowProps) {
  const body = <>
    {leading && <span className="ui-list-row__lead">{leading}</span>}
    <span className="ui-list-row__text"><span className="ui-list-row__title">{title}</span>{meta && <span className="ui-list-row__meta">{meta}</span>}</span>
  </>;
  return <div className={`ui-list-row${selected ? " is-selected" : ""} ${className}`.trim()}>
    {href ? <a className="ui-list-row__main" href={href}>{body}</a> : <div className="ui-list-row__main">{body}</div>}
    {trailing && <span className="ui-list-row__trail">{trailing}</span>}
  </div>;
}
