import { headers } from 'next/headers';
import { requireViewer } from '@/server/context';
import { workspaceDateKey, addDaysToKey } from '@/lib/calendar-dates';
import { OperationError } from '@/lib/operation-error';
import { FEATURES, type Area, type Locale, type Feed, type KeyDate, type Note, type Season } from '../contracts';
import { calendarOptions, listCalendarEntries } from '../server/service';
import { CalendarWorkspace } from './CalendarWorkspace';
import { TrendPanels } from './TrendPanels';
export type ScreenProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };
export async function CalendarExtrasScreen({ area, searchParams }: ScreenProps & { area: Area }) {
 const locale: Locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
 const viewer = await requireViewer({ feature: FEATURES[area], channelScoped: true });
 const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId, locale };
 const [options, params] = await Promise.all([calendarOptions(actor, area), searchParams]);
 const text = (key: string, fallback = '') => typeof params[key] === 'string' ? params[key] as string : fallback;
 const from = text('from', workspaceDateKey(new Date(), options.timeZone));
 const to = text('to', addDaysToKey(workspaceDateKey(new Date(), options.timeZone), options.policy.defaultRangeDays));
 const offset = params.offset === undefined ? 0 : Number(text('offset'));
 const targetId = text('targetId');
 let error = '';
 let rows: Array<Feed | KeyDate | Note | Season> = [], hasMore = false, limit = options.policy.pageSize;
 let trends: Awaited<ReturnType<typeof listCalendarEntries>> | null = null;
 try {
  if (Object.values(params).some(value => Array.isArray(value)) || params.showAll !== undefined && !['true', 'false'].includes(text('showAll'))) throw new OperationError('invalid_request', options.copy.invalid);
  const result = await listCalendarEntries(actor, area, { from, to, offset, ...(targetId ? { targetId } : {}), ...(area === 'trends' ? { showAll: text('showAll') === 'true' } : {}) });
  if ('countries' in result) trends = result;
  else rows = result.items;
  hasMore = result.hasMore; limit = result.limit;
 } catch (e) { error = e instanceof OperationError ? e.message : options.copy.unavailable; }
 return <CalendarWorkspace area={area} workspaceId={actor.workspaceId} locale={locale} {...options} rows={rows} hasMore={hasMore} offset={Number.isSafeInteger(offset) && offset >= 0 ? offset : 0} limit={limit} from={from} to={to} targetId={targetId} showAll={text('showAll') === 'true'} error={error}>
  {trends && 'countries' in trends && <TrendPanels data={trends} copy={options.copy} locale={locale} workspaceId={actor.workspaceId} canWrite={options.canWrite && options.allChannels} />}
 </CalendarWorkspace>;
}
export const KeyDatesScreen = (props: ScreenProps) => <CalendarExtrasScreen {...props} area="dates" />;
export const SeasonsScreen = (props: ScreenProps) => <CalendarExtrasScreen {...props} area="seasons" />;
export const CalendarFeedsScreen = (props: ScreenProps) => <CalendarExtrasScreen {...props} area="feeds" />;
export const ChartNotesScreen = (props: ScreenProps) => <CalendarExtrasScreen {...props} area="notes" />;
export const TrendsScreen = (props: ScreenProps) => <CalendarExtrasScreen {...props} area="trends" />;
