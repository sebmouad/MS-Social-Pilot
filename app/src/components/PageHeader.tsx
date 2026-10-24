import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  description?: ReactNode;
  /** Module id (home, publishing, inbox, analytics, ads, tasks, agency, settings, root): colors the title accent. */
  module?: string;
  /** Kept for callers that still pass a glyph; the v2 header shows no icon chip. */
  icon?: ReactNode;
  breadcrumbs?: ReactNode;
  /** Item count next to the title, for example "132". */
  count?: ReactNode;
  /** An ⓘ for a sentence that cannot be left out. */
  info?: ReactNode;
  /** At most one primary and two secondary actions; the rest go into a "More" menu. They wrap under the title on phones. */
  actions?: ReactNode;
  /** Link tabs of the area (Primer UnderlineNav), directly under the title row. */
  tabs?: ReactNode;
  /** Filter row: the page's single Filter button, active-filter chips and search. */
  filters?: ReactNode;
  /** Level of the title element. Pages use 1; panels inside a page use 2. */
  level?: 1 | 2;
};

/** Page title row: title, count, ⓘ and actions, then tabs and the filter row when the page has them. */
export function PageHeader({ title, description, module, breadcrumbs, count, info, actions, tabs, filters, level = 1 }: PageHeaderProps) {
  const Heading = level === 1 ? "h1" : "h2";
  // Without tabs or a description the filters fit on the title row, which keeps the page compact.
  const inline = Boolean(filters) && !tabs && !description;
  return <header className="ui-page-header" data-module={module}>
    {breadcrumbs}
    <div className="ui-page-header__row">
      <div className="ui-page-header__text">
        <div className="ui-page-header__titleline"><Heading>{title}</Heading>{count !== undefined && count !== null && <span className="ui-page-header__count">{count}</span>}{info}</div>
        {description && <p>{description}</p>}
      </div>
      {inline && <div className="ui-page-header__filters is-inline">{filters}</div>}
      {actions && <div className="ui-page-header__actions">{actions}</div>}
    </div>
    {tabs}
    {filters && !inline && <div className="ui-page-header__filters">{filters}</div>}
  </header>;
}
