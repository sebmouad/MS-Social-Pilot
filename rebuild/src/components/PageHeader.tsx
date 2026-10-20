import type { ReactNode } from "react";
import { ModuleGlyph } from "./icons";

type PageHeaderProps = {
  title: string;
  description?: ReactNode;
  /** Module id (home, publishing, inbox, analytics, ads, tasks, agency, settings, root): colors the icon chip. */
  module?: string;
  /** Overrides the module icon. */
  icon?: ReactNode;
  breadcrumbs?: ReactNode;
  /** Primary and secondary actions, right-aligned; they wrap under the title on phones. */
  actions?: ReactNode;
  /** Level of the title element. Pages use 1; panels inside a page use 2. */
  level?: 1 | 2;
};

/** Page title row: module icon chip, title, description and actions. */
export function PageHeader({ title, description, module, icon, breadcrumbs, actions, level = 1 }: PageHeaderProps) {
  const Heading = level === 1 ? "h1" : "h2";
  return <header className="ui-page-header" data-module={module}>
    {breadcrumbs}
    <div className="ui-page-header__row">
      {(module || icon) && <span className="ui-mod-chip ui-page-header__chip" aria-hidden="true">{icon ?? (module && <ModuleGlyph id={module} size={22} />)}</span>}
      <div className="ui-page-header__text">
        <Heading>{title}</Heading>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="ui-page-header__actions">{actions}</div>}
    </div>
  </header>;
}
