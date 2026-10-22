import { PageFrame } from '@/server/PageFrame';
import CaptionTestsPage from '@/modules/caption-tests/ui/CaptionTestsPage';

/** Insights pages frame themselves (see the Insights layout); caption tests share the single sidebar shell. */
export default function CaptionTestsRoute() {
  return <PageFrame module="analytics" scopedAccess><CaptionTestsPage /></PageFrame>;
}
