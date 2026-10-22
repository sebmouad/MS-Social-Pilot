import { z } from 'zod';
import { entry, stringList } from '@/lib/config/entry';
import { ERRORS_CONFIG } from '@/server/errors/config';
import { HISTORY_ACTION_LABELS, HISTORY_COPY, historyActionLabelsSchema, historyCopySchema } from './copy';
import { ROOT_CHANGELOG_COPY, rootChangelogCopySchema } from './root-copy';
import { OPERATOR_DEFAULTS, SITE_CONTENT_DEFAULTS, operatorSchema, siteContentSchema } from './public/content';

/**
 * Root settings of the History feature (prefix `history.`, owned by Settings), plus the shared-infrastructure
 * settings this folder serves: the public site (`public.`), the health probe (`health.`) and the error recorder
 * (`errors.`, declared beside the recorder). Registered by the installed module host.
 */
export const HISTORY_CONFIG = [
  entry({ key: 'history.customerCopy', group: 'History', label: 'History screen copy', kind: 'json', description: 'English and French labels, empty states and feedback for Settings › History. Keep {days}, {count}, {from} and {to} where they appear.', defaultValue: HISTORY_COPY, schema: historyCopySchema, consumption: 'active' }),
  entry({ key: 'history.actionLabels', group: 'History', label: 'Activity action labels', kind: 'json', description: 'Readable English and French text for activity codes such as tasks.created. Unlisted codes are shown as words made from the code.', defaultValue: HISTORY_ACTION_LABELS, schema: historyActionLabelsSchema, consumption: 'active' }),
  entry({ key: 'history.pageSize', group: 'History', label: 'History page size', kind: 'number', description: 'Entries shown per page in Settings › History and returned per call by REST and MCP.', defaultValue: 50, schema: z.number().int().min(1).max(500), consumption: 'active' }),
  entry({ key: 'history.maxOffset', group: 'History', label: 'Deepest history position', kind: 'number', description: 'Largest offset a reader may skip to. Deeper entries are reached by narrowing the search.', defaultValue: 100000, schema: z.number().int().min(0).max(10000000), consumption: 'active' }),
  entry({ key: 'history.searchMaxCharacters', group: 'History', label: 'History search length', kind: 'number', description: 'Longest search text accepted by the History filters.', defaultValue: 100, schema: z.number().int().min(1).max(500), consumption: 'active' }),
  entry({ key: 'history.detailMaxFields', group: 'History', label: 'Detail fields per entry', kind: 'number', description: 'How many fields of an activity entry’s detail are shown.', defaultValue: 8, schema: z.number().int().min(0).max(50), consumption: 'active' }),
  entry({ key: 'history.detailValueMaxCharacters', group: 'History', label: 'Detail value length', kind: 'number', description: 'Longest value shown for one detail field before it is cut.', defaultValue: 120, schema: z.number().int().min(10).max(2000), consumption: 'active' }),
  entry({ key: 'history.errorMaxCharacters', group: 'History', label: 'Email problem text length', kind: 'number', description: 'Longest delivery problem text shown for an email, after addresses and secrets are removed.', defaultValue: 300, schema: z.number().int().min(20).max(4000), consumption: 'active' }),
  entry({ key: 'history.recentFailureDays', group: 'History', label: 'Recent email problem window (days)', kind: 'number', description: 'How far back the email problem notice counts undelivered emails.', defaultValue: 7, schema: z.number().int().min(1).max(365), consumption: 'active' }),
  entry({ key: 'history.hiddenDetailKeys', group: 'History', label: 'Hidden detail keys', kind: 'json', description: 'Detail fields whose name contains any of these words are never shown.', defaultValue: ['token', 'secret', 'password', 'key', 'hash', 'signature', 'authorization', 'cookie'], schema: stringList, consumption: 'active' }),

  entry({ key: 'public.siteEnabled', group: 'Public site', label: 'Public site on', kind: 'boolean', description: 'Show the Help, Pricing, Status and What’s new pages to visitors. Off keeps them hidden (404). Privacy, Terms and Data deletion are always public because Meta links to them.', defaultValue: false, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'public.operator', group: 'Public site', label: 'Operator details', kind: 'json', description: 'Who runs this installation, used by the privacy policy, terms and data deletion pages: productName, name, country, address, email, governingLaw, dataProtection, hosting, legalUpdated.', defaultValue: OPERATOR_DEFAULTS, schema: operatorSchema, consumption: 'active' }),
  entry({ key: 'public.content', group: 'Public site', label: 'Public page content', kind: 'json', description: 'English and French text of Help, Pricing, Status, What’s new, Privacy, Terms and Data deletion. Blank line = new paragraph, "- " = list item, [label](/path) = link. {placeholders} come from the operator details.', defaultValue: SITE_CONTENT_DEFAULTS, schema: siteContentSchema, consumption: 'active' }),
  entry({ key: 'public.changelogPageSize', group: 'Public site', label: 'Changelog entries per page', kind: 'number', description: 'Entries shown on the public What’s new page and per call in Root › Changelog (REST and MCP).', defaultValue: 100, schema: z.number().int().min(1).max(1000), consumption: 'active' }),
  entry({ key: 'public.changelogTitleMaxCharacters', group: 'Public site', label: 'Changelog title length', kind: 'number', description: 'Longest title of a changelog entry.', defaultValue: 200, schema: z.number().int().min(10).max(1000), consumption: 'active' }),
  entry({ key: 'public.changelogBodyMaxCharacters', group: 'Public site', label: 'Changelog text length', kind: 'number', description: 'Longest text of a changelog entry.', defaultValue: 5000, schema: z.number().int().min(0).max(50000), consumption: 'active' }),
  entry({ key: 'public.dataDeletionCodeMaxCharacters', group: 'Public site', label: 'Deletion code length', kind: 'number', description: 'Longest confirmation code accepted by the data deletion status lookup.', defaultValue: 100, schema: z.number().int().min(8).max(500), consumption: 'active' }),

  entry({ key: 'root.changelogCopy', group: 'Public site', label: 'Root changelog screen copy', kind: 'json', description: 'English and French labels and feedback for Root › Changelog.', defaultValue: ROOT_CHANGELOG_COPY, schema: rootChangelogCopySchema, consumption: 'active' }),

  entry({ key: 'health.databaseTimeoutMs', group: 'Health', label: 'Health database check timeout (ms)', kind: 'number', description: 'How long /api/health and the public Status page wait for the database before reporting it unavailable.', defaultValue: 3000, schema: z.number().int().min(100).max(60000), consumption: 'active' }),

  ...ERRORS_CONFIG,
] as const;
