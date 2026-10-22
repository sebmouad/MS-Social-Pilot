import { entry } from '@/lib/config/entry';
import { SHELL_COPY, SHELL_POLICY, shellCopySchema, shellPolicySchema } from './copy';

/** Root settings of the shared customer shell (sidebar, header, popovers, phone bar), registered under the Home namespace. */
export const SHELL_CONFIG = [
  entry({ key: 'home.shellCopy', group: 'Home · Shell', label: 'Navigation and header copy', kind: 'json', description: 'English and French text of the sidebar, area tabs, channel list, header Filter button, info popovers and phone bar. Keep named placeholders such as {count} when editing.', defaultValue: SHELL_COPY, schema: shellCopySchema, consumption: 'active' }),
  entry({ key: 'home.shellPolicy', group: 'Home · Shell', label: 'Navigation behaviour', kind: 'json', description: 'Channels listed before "Show all", the channel count that adds a search field, tabs shown before "More", cookie lifetimes (days) for the remembered channel scope and sidebar state, and the info-popover hover delay.', defaultValue: SHELL_POLICY, schema: shellPolicySchema, consumption: 'active' }),
] as const;
