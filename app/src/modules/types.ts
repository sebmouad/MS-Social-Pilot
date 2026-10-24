import type { ModuleHealthDeclaration } from '@/server/root/module-health-types';
/** A customer-facing feature declared by a module manifest. */
export interface ModulePageManifest {
  readonly id: string;
  readonly title: string;
  readonly href: string;
  readonly description: string;
  /** Sidebar area override: lets one page join another area than its module's (for example the analytics-owned Analysis page joins the Ads area). */
  readonly area?: AreaId;
  readonly navigation?: boolean;
  /** Reachable from the command palette even when hidden from tabs/sidebar (Insights sub-pages: goals, pins, notes). */
  readonly palette?: boolean;
  /** Position among the area's tabs when pages of several modules share an area (lower first); pages without one keep manifest order after them. */
  readonly tabOrder?: number;
  /** Other routes (and their sub-paths) that keep this page's tab current, for related screens outside its own route. */
  readonly tabRoutes?: readonly string[];
}

/** Customer work areas of the single sidebar (design v2). Pages join an area through their page-level `area`, else their module's `area`. */
export type AreaId = 'home' | 'content' | 'inbox' | 'insights' | 'ads' | 'tasks' | 'agency' | 'settings';

/** An old route that moves permanently (308). `from`/`to` may end in `/*` to move a whole prefix; `params` renames query parameters. */
export interface RouteRedirect {
  readonly from: string;
  readonly to: string;
  readonly params?: Readonly<Record<string, string>>;
}

/** Source of truth for one independently available customer module. */
export interface ModuleManifest {
  /** Routes this module moved in the design v2 batches; the middleware serves them as 308 redirects. */
  readonly redirects?: readonly RouteRedirect[];
  /** Sidebar area this module's pages belong to; page labels live in the Root-editable shell catalog. */
  readonly area?: AreaId;
  readonly health: ModuleHealthDeclaration;
  /** Core setting namespaces owned by this product module; platform ownership takes precedence. */
  readonly rootSettingsPrefixes: readonly string[];
  readonly rootSettingKeys: readonly string[];
  /** Background work owned by this module, shared by worker and Root diagnostics. */
  readonly jobs: readonly { name: string; label: string; configKey: string }[];
  readonly id: string;
  readonly title: string;
  readonly mobileTitle?: string;
  readonly href: string;
  readonly pages: readonly ModulePageManifest[];
  readonly primaryAction?: { readonly href: string; readonly label: string; readonly featureId: string };
}
