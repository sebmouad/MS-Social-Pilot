import { z } from 'zod';
import { entry } from '@/lib/config/entry';
import { ownerCopy, ownerCopySchema } from './ui/owner-copy';
import { publicCopyDefaults, publicCopySchema } from './ui/copy';

const n = (min: number, max: number) => z.number().int().min(min).max(max);
const G = 'Sharing · Client links';
const B = 'Sharing · Public bio page';
const num = (key: string, group: string, label: string, description: string, defaultValue: number, schema: z.ZodNumber) =>
  entry({ key, group, label, kind: 'number', description, defaultValue, schema, consumption: 'active' });
const text = (key: string, group: string, label: string, description: string, defaultValue: string, max: number) =>
  entry({ key, group, label, kind: 'text', description, defaultValue, schema: z.string().trim().max(max), consumption: 'active' });

/** Root-managed bounds for client links and the public bio page. Values are read at use; none are hardcoded in services. */
export const SHARING_LIMIT_CONFIG = [
  num('sharing.channelPickerLimit', G, 'Shareable channel picker limit', 'Maximum eligible channels shown in the sharing selector after authorization filtering.', 500, n(1, 5000)),
  num('sharing.pageSize', G, 'Share link page size', 'Share links listed on one page of the owner view.', 25, n(5, 100)),
  num('sharing.feedbackPageSize', G, 'Feedback page size', 'Client answers listed on one page of a link\'s feedback.', 25, n(5, 100)),
  num('sharing.maxLinksPerWorkspace', G, 'Share links per workspace', 'Maximum share links (active or not) stored per workspace.', 200, n(1, 5000)),
  num('sharing.defaultExpiryDays', G, 'Default link lifetime (days)', 'Lifetime of a new share link when the creator does not choose one.', 30, n(1, 365)),
  num('sharing.maxExpiryDays', G, 'Maximum link lifetime (days)', 'Longest lifetime a share link may be given.', 180, n(1, 730)),
  num('sharing.maxDaysBack', G, 'Calendar days back limit', 'Furthest back a calendar or portal link may show.', 90, n(0, 365)),
  num('sharing.maxDaysAhead', G, 'Calendar days ahead limit', 'Furthest ahead a calendar or portal link may show.', 120, n(1, 365)),
  num('sharing.maxItemsPerView', G, 'Posts per public view', 'Most posts one public share view returns.', 100, n(1, 500)),
  num('sharing.maxTargetsPerLink', G, 'Channels per link', 'Most channels one share link may be limited to.', 100, n(1, 500)),
  num('sharing.titleMaxCharacters', G, 'Link title limit', 'Maximum characters in a share link title.', 120, n(10, 240)),
  num('sharing.descriptionMaxCharacters', G, 'Link description limit', 'Maximum characters in a share link description.', 500, n(0, 2000)),
  num('sharing.commentMaxCharacters', G, 'Client comment limit', 'Maximum characters in a client comment. Answers that settle a post are further limited by the review note size.', 2000, n(10, 10000)),
  num('sharing.authorNameMaxCharacters', G, 'Client name limit', 'Maximum characters in the name a client gives with feedback.', 80, n(2, 200)),
  num('sharing.viewRateLimit', G, 'Public view requests per window', 'Public share and bio page opens allowed per visitor address in one window.', 120, n(5, 5000)),
  num('sharing.viewRateWindowMs', G, 'Public view window (ms)', 'Length of the public view rate window.', 600000, n(1000, 3600000)),
  num('sharing.mediaRateLimit', G, 'Public image requests per window', 'Uploaded-image previews allowed per visitor address in one view window (a page loads one request per image).', 600, n(10, 20000)),
  num('sharing.anonymousVisitorFactor', G, 'Unknown-address allowance factor', 'Without a trusted proxy visitor addresses are unknown; each link or page then shares one bucket whose limits are multiplied by this factor.', 20, n(1, 1000)),
  num('sharing.decisionBodyMaxBytes', G, 'Feedback request size', 'Maximum actual streamed UTF-8 bytes accepted by the public feedback endpoint.', 65536, n(1024, 1048576)),
  num('sharing.decisionRateLimit', G, 'Client decisions per window', 'Feedback submissions allowed per visitor address and per link in one window.', 30, n(1, 500)),
  num('sharing.decisionRateWindowMs', G, 'Client decision window (ms)', 'Length of the feedback rate window.', 600000, n(1000, 3600000)),
  num('sharing.decisionLinkFactor', G, 'Link-wide decision multiplier', 'All answers to one link together may be this many times the per-address decision allowance in one window.', 4, n(1, 100)),
  num('sharing.rateStoreCapacity', G, 'Public rate-limit store size', 'Most visitor windows the public sharing and bio limiter remembers at once (separate from sign-in limits). Oldest windows are dropped first.', 5000, n(100, 100000)),
  num('sharing.transactionTimeoutMs', G, 'Sharing transaction timeout', 'Maximum duration of one share or bio mutation transaction.', 5000, n(500, 30000)),
  num('sharing.transactionMaxWaitMs', G, 'Sharing transaction wait', 'Maximum wait for a share or bio mutation transaction slot.', 2000, n(100, 10000)),
  num('bio.maxLinks', B, 'Bio links limit', 'Most links a public bio page may list.', 30, n(1, 100)),
  num('bio.titleMaxCharacters', B, 'Bio title limit', 'Maximum characters in a bio page title.', 80, n(10, 200)),
  num('bio.descriptionMaxCharacters', B, 'Bio description limit', 'Maximum characters in a bio page description.', 300, n(0, 1000)),
  num('bio.linkLabelMaxCharacters', B, 'Bio link label limit', 'Maximum characters in a bio link label.', 80, n(5, 200)),
  num('bio.urlMaxCharacters', B, 'Bio URL limit', 'Maximum characters in a bio link or avatar address.', 2048, n(64, 4096)),
  num('bio.clickRateLimit', B, 'Counted bio clicks per window', 'Clicks per visitor address and page counted in one window. Extra clicks still redirect but are not counted.', 60, n(1, 5000)),
  num('bio.clickRateWindowMs', B, 'Bio click window (ms)', 'Length of the bio click counting window.', 60000, n(1000, 3600000)),
  num('bio.ownerScanLimit', B, 'Bio owner qualification limit', 'Maximum active workspace owners checked for current bio access on a public request.', 100, n(1, 2000)),
  num('bio.availabilityCacheEntries', B, 'Unavailable bio cache capacity', 'Maximum workspace refusal entries retained by this process.', 2000, n(1, 50000)),
  num('bio.availabilityCacheMs', B, 'Unavailable bio retry interval (ms)', 'Cache refusals only for this interval. Successful grants are always rechecked; revocation takes effect on the next request. 0 disables refusal caching.', 60000, n(0, 600000)),
] as const;

/** Root-managed visitor-facing copy. Empty means "show nothing"; values are rendered as plain text, never as markup. */
export const SHARING_COPY_CONFIG = [
  text('sharing.copy.intro', G, 'Share page introduction', 'Short text shown under the title of every public share page. Leave empty to show none.', '', 300),
  text('sharing.copy.answerNotice', G, 'Answer notice', 'Reminder shown next to the answer form on review pages.', 'Your name and answer are shared with the team that sent you this link.', 300),
  text('bio.copy.footer', B, 'Bio page footer', 'Small text shown at the bottom of every public bio page. Leave empty to show none.', '', 200),
] as const;

/** Root-managed interface text, English and French: the signed-in screens and the signed-out visitor pages. */
export const SHARING_UI_COPY_CONFIG = [
  entry({ key: 'sharing.ownerCopy', group: G, label: 'Sharing screen copy', kind: 'json', description: 'English and French labels, confirmations and feedback of the client links and bio page settings screens.', defaultValue: ownerCopy, schema: ownerCopySchema, consumption: 'active' }),
  entry({ key: 'sharing.publicCopy', group: G, label: 'Public share and bio page copy', kind: 'json', description: 'English and French text of the signed-out share, review and bio pages. The visitor\'s browser language picks the version.', defaultValue: publicCopyDefaults, schema: publicCopySchema, consumption: 'active' }),
] as const;

export const SHARING_CONFIG = [...SHARING_LIMIT_CONFIG, ...SHARING_COPY_CONFIG, ...SHARING_UI_COPY_CONFIG] as const;

export type SharingLimits = Record<string, number>;
export type SharingCopy = { intro: string; answerNotice: string; bioFooter: string };
