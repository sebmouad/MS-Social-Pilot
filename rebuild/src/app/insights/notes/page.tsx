import { PageFrame } from '@/server/PageFrame';
import { ChartNotesScreen, type ScreenProps } from '@/modules/calendar-extras/ui/CalendarExtrasScreen';

/** Insights pages frame themselves (see the Insights layout); chart notes share the single sidebar shell. */
export default function ChartNotesPage(props: ScreenProps) {
  return <PageFrame module="analytics" scopedAccess><ChartNotesScreen {...props} /></PageFrame>;
}
