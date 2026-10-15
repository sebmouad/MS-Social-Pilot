import { Suspense, type ReactNode } from "react";
import { PageFrame } from "@/server/PageFrame";
import { requireViewer } from '@/server/context';
import { getTargets } from '@/server/data';
import { workspaceDateKey } from '@/lib/calendar-dates';
import { PublishingSidebar } from './PublishingSidebar';
import styles from "./publishing.module.css";

export default async function PublishingLayout({ children }: { children: ReactNode }) {
  const viewer = await requireViewer({ module: 'publishing', channelScoped: true });
  const allowedIds = viewer.permissions.pageScope.all ? null : viewer.permissions.pageScope.ids;
  const targets = await getTargets(viewer.workspaceId);
  const channels = targets.filter(target => allowedIds === null || allowedIds.includes(target.id)).map(target => ({ id: target.id, name: target.name }));
  const sidebar = <Suspense fallback={null}><PublishingSidebar channels={channels} today={workspaceDateKey(new Date(), viewer.membership.workspace.timezone)} /></Suspense>;
  return <PageFrame module="publishing" scopedAccess sidebar={sidebar} sidebarWhen={['/publishing/posts', '/publishing/calendar']}><div className={styles.page}>
    {children}
  </div></PageFrame>;
}
