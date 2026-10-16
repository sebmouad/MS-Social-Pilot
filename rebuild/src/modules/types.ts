/** A customer-facing feature declared by a module manifest. */
export interface ModulePageManifest {
  readonly id: string;
  readonly title: string;
  readonly href: string;
  readonly description: string;
  readonly navigation?: boolean;
}

/** Source of truth for one independently available customer module. */
export interface ModuleManifest {
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
