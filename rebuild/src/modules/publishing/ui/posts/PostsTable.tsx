'use client';
import { usePublishingCopy } from '../kit/CopyProvider';

import { useState, type ComponentProps, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { IconExternalLink, IconPencil } from '@tabler/icons-react';
import { DataTable, Drawer, type TableColumn } from '@/components';
import { type KitLocale } from '../kit/copy';
import { BulkPostActions } from './BulkPostActions';
import { PostRowActions } from './PostActions';
import type { PostOriginView } from '../origins/post-origin';
import { ChannelsCell, PostCell, StatusCell } from './PostTableCells';

type ManageProps = ComponentProps<typeof PostRowActions>;
export type PostsTableRow = ManageProps['post'] & {
  id: string; authorId: string; createdAt: Date; scheduledAt: Date | null;
  targets: Array<ManageProps['post']['targets'][number] & { remoteUrl: string | null; target: { id: string; type: string; name: string; pictureUrl: string | null; platformName?: string | null } }>;
  /** Publish time already formatted in the workspace time zone on the server, so hydration cannot disagree. */
  whenLabel: string;
  /** Set when an installed automation created the post. */
  origin?: PostOriginView | null;
  /** Per-row authority decided by the server; the actions re-check on submit. */
  canEdit: boolean; canDuplicate: boolean;
};
export type PostsTableManage = Pick<ManageProps, 'targets' | 'canPublish' | 'canOrganize' | 'canQueue' | 'imageRules' | 'timeZone' | 'undoSendSeconds'>;

/**
 * The posts list on the shared DataTable: row selection with a bulk toolbar, a row menu, and a side drawer
 * that keeps the list visible while one post is managed. Empty and no-match states come from the caller.
 */
export function PostsTable({ rows, caption, locale = 'en', selectable, canRetry, manage, empty }: { rows: PostsTableRow[]; caption: string; locale?: KitLocale; selectable: boolean; canRetry: boolean; manage: PostsTableManage | null; empty: ReactNode }) {
  const copy = usePublishingCopy(locale);
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [managing, setManaging] = useState<string | null>(null);
  const current = rows.find(row => row.id === managing) ?? null;
  const label = (row: PostsTableRow) => row.message.slice(0, 60) || row.id;

  const columns: TableColumn<PostsTableRow>[] = [
    { key: 'post', label: copy.columnPost, render: row => <PostCell post={row} locale={locale} /> },
    { key: 'channels', label: copy.columnChannels, render: row => <ChannelsCell post={row} locale={locale} /> },
    { key: 'status', label: copy.columnStatus, render: row => <StatusCell post={row} locale={locale} /> },
    { key: 'scheduled', label: copy.columnWhen, render: row => row.whenLabel },
  ];
  if (!rows.length) return <>{empty}</>;
  return <>
    {selectable ? <BulkPostActions selected={selected} onClear={() => setSelected([])} canRetry={canRetry} locale={locale} /> : null}
    <DataTable columns={columns} rows={rows} rowKey={row => row.id} caption={caption}
      selection={selectable ? { selected, onChange: setSelected, rowLabel: row => copy.selectPost(label(row)), selectAllLabel: copy.selectAll } : undefined}
      rowActionsLabel={row => copy.actionsFor(label(row))}
      rowActions={row => [
        ...(manage && row.canEdit ? [{ key: 'manage', label: copy.manage, icon: <IconPencil size={16} />, onSelect: () => setManaging(row.id) }] : []),
        { key: 'details', label: copy.openDetails, icon: <IconExternalLink size={16} />, onSelect: () => router.push(`/publishing/collaboration/post/${encodeURIComponent(row.id)}`) },
      ]} />
    <Drawer open={Boolean(current && manage)} title={copy.manage} description={current ? label(current) : undefined} closeLabel={copy.close} onClose={() => setManaging(null)}>
      {current && manage ? <PostRowActions post={current} canEdit={current.canEdit} canDuplicate={current.canDuplicate} {...manage} /> : null}
    </Drawer>
  </>;
}
