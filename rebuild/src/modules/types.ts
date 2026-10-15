/** A customer-facing feature declared by a module manifest. */
export interface ModulePageManifest {
  readonly id: string;
  readonly title: string;
  readonly href: string;
  readonly description: string;
}

/** Source of truth for one independently available customer module. */
export interface ModuleManifest {
  readonly id: string;
  readonly title: string;
  readonly href: string;
  readonly pages: readonly ModulePageManifest[];
}
