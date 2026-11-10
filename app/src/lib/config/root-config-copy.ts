/** Default operator catalog; Root may override each field through root.configCopy. */
export const ROOT_CONFIG_COPY = {
  "metadataTitle": "Configuration · Root",
  "databaseSource": "database",
  "pageTitle": "Configuration",
  "eyebrow": "Root · Installation",
  "intro": "Every setting of this installation. Search by name, key or description, or pick a section.",
  "unavailable": "Settings could not be loaded. Reload to try again.",
  "sectionsLabel": "Root configuration sections",
  "find": "Find a setting",
  "searchPlaceholder": "Search settings",
  "categoriesLabel": "Configuration categories",
  "searchResults": "Search results for “{search}”",
  "count": "{count} settings",
  "empty": "No matching settings.",
  "allSections": "All sections",
  "searchMore": "Showing the first {shown} of {count}. Add a word to narrow the search.",
  "customValue": "Changed",
  "on": "On",
  "off": "Off",
  "saving": "Saving…",
  "clearing": "Clearing…",
  "saveFailure": "Could not save this setting. Check your connection and try again.",
  "clearFailure": "Could not clear this setting. Check your connection and try again.",
  "invalidResponse": "Invalid configuration response.",
  "saved": "Saved.",
  "cleared": "Saved secret cleared.",
  "enabled": "Enabled",
  "hidden": "Saved value hidden",
  "enterSecret": "Enter secret",
  "invalidJson": "{label}: enter valid JSON.",
  "save": "Save",
  "clearSecret": "Clear saved secret",
  "source": "Source:",
  "defaultSource": "default",
  "active": "Active",
  "configured": "Stored; runtime wiring pending",
  "planned": "Stored; consumer not implemented",
  "concealed": "saved value is concealed",
  "inventory": "Manifest inventory",
  "inventoryDescription": "These modules and features come from the product manifests. Changes apply to the next request and remain subject to workspace and plan access.",
  "modules": "Modules",
  "features": "Features",
  "shared": "Shared controls",
  "product": "Product",
  "platform": "Platform"
} as const;
export type RootConfigCopy = { [K in keyof typeof ROOT_CONFIG_COPY]: string };

/** Replace only named placeholders; configuration text is rendered as plain React text. */
export function configCopyText(template: string, values: Record<string, string | number>) {
  return template.replace(/\{([A-Za-z]+)\}/g, (match, key: string) => key in values ? String(values[key]) : match);
}
