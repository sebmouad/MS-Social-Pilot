import { Suspense, type ReactNode } from "react";
import { PageFrame } from "@/server/PageFrame";
import { requireViewer } from '@/server/context';
import { getTargets } from '@/server/data';
import { selectedPublishingTargetIds } from '@/modules/publishing/server/read-scope';
import { workspaceDateKey } from '@/lib/calendar-dates';
import { PublishingSidebar } from './PublishingSidebar';
import styles from "./publishing.module.css";
import { runtimeConfig } from '@/server/config/store';

export default async function PublishingLayout({ children }: { children: ReactNode }) {
  const viewer = await requireViewer({ module: 'publishing', channelScoped: true });
  const ids = await selectedPublishingTargetIds(viewer.workspaceId, viewer.entitlements, viewer.permissions.pageScope.all ? undefined : viewer.permissions.pageScope.ids);
  const targets = await getTargets(viewer.workspaceId, ids);
  const channels = targets.map(target => ({ id: target.id, name: target.name }));
  const [searchMaxCharacters, exportMaxPosts, exportMaxBytes] = await Promise.all([
    runtimeConfig('publishing.searchMaxCharacters'), runtimeConfig('publishing.exportMaxPosts'), runtimeConfig('publishing.exportMaxBytes'),
  ]);
  const sidebar = <Suspense fallback={null}><PublishingSidebar channels={channels} today={workspaceDateKey(new Date(), viewer.membership.workspace.timezone)} searchMaxCharacters={searchMaxCharacters} exportMaxPosts={exportMaxPosts} exportMaxBytes={exportMaxBytes} /></Suspense>;
  return <PageFrame module="publishing" scopedAccess sidebar={sidebar} sidebarWhen={['/publishing/posts', '/publishing/calendar', '/publishing/templates', '/publishing/labels']}><div className={styles.page}>
    {children}
  </div></PageFrame>;
}
