import type { Entry } from '@/lib/config/entry';
import type { CapabilityDeclaration } from './types';

/**
 * A platform module: everything one social network brings to the product.
 *
 * A module is installed by adding it to `src/platforms/index.ts` (manifest and
 * settings) and its server wiring to `src/server/platforms/index.ts`. Nothing
 * else in the product names a platform: navigation, connection buttons, Root
 * settings, the on/off switch and capability checks are all generated from the
 * installed modules. Root can switch each module on or off; a switched-off
 * module is invisible to customers and its connected data stays stored.
 */
export interface PlatformModule {
  /** Stable provider ID stored with connections and channels. */
  readonly id: string;
  /** Customer-facing name. */
  readonly name: string;
  /** One sentence for Root's Platforms screen. */
  readonly description: string;
  /** Badge shown next to channels: a short mark and its brand colour. */
  readonly mark: { readonly text: string; readonly color: string };
  /** What the module can do once it is configured. */
  readonly capabilities: CapabilityDeclaration;
  /** Kinds of channel the module discovers, with their customer-facing labels. */
  readonly channelKinds: readonly { readonly kind: string; readonly label: string }[];
  /** Root setting that switches the module on or off (`platforms.<id>.enabled`). */
  readonly enabledKey: string;
  /** Root settings that must be filled in before customers can connect. */
  readonly requiredSettings: readonly string[];
  /** Settings group prefix used on Root's configuration screen. */
  readonly settingsGroup: string;
}

/** The on/off switch every module gets, so all modules behave the same way. */
export function enabledEntry(id: string, name: string, defaultValue: boolean) {
  return {
    key: `platforms.${id}.enabled`,
    group: `${name} · Engine`,
    label: `${name} module enabled`,
    kind: 'boolean',
    description: `Make ${name} available to workspaces. When off, customers cannot see or connect ${name}; connected data remains stored.`,
    defaultValue,
    consumption: 'active',
  } as const satisfies Omit<Entry, 'schema'>;
}
