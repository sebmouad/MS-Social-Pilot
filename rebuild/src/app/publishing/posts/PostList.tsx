import type { ReactNode } from "react";
import { PostRowActions, type RowActionFlags } from "./PostActions";
import { PlatformChannels, StatusChip, formatDate } from "../publishing-ui";
import type { PostSummary } from "@/server/data";
import styles from "../publishing.module.css";

export type ListPost = PostSummary & {
  firstComment: string | null;
  authorId: string;
  link: string | null;
  media: Array<{ kind: string; url: string; altText?: string }>;
};
export type ListContext = {
  timeZone: string;
  userId: string;
  /** Owner, admin or editor. */
  isManager: boolean;
  /** Anyone allowed to write posts. */
  isAuthor: boolean;
  /** At least one channel can publish right now. */
  canPublish: boolean;
  labels: Record<string, { name: string; mark: { text: string; color: string } }>;
  mode?: "full" | "queue";
};

function Thumb({ post }: { post: ListPost }) {
  const image = post.media.find(item => item.kind === "image");
  const video = post.media.find(item => item.kind === "video");
  const src = image ? (image.url.startsWith("media:") ? `/api/media/${encodeURIComponent(image.url.slice(6))}` : image.url.startsWith("https://") ? image.url : "") : "";
  if (src) return <div className={styles.thumb}><img src={src} alt={image?.altText || "Attached image"} width={96} height={96} loading="lazy" /></div>;
  const shape: ReactNode = video
    ? <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="m10 8.5 5.5 3.5-5.5 3.5z" fill="currentColor" /></svg>
    : post.link ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg> : null;
  if (!shape) return null;
  return <div className={styles.thumb} data-kind={video ? "video" : "link"}>{shape}<span>{video ? "Video" : "Link"}</span></div>;
}

function whenLabel(post: ListPost, timeZone: string): ReactNode {
  if (post.status === "published" || post.status === "partially_failed") return <>Published <time dateTime={(post.publishedAt ?? post.createdAt).toISOString()}>{formatDate(post.publishedAt ?? post.createdAt, timeZone)}</time></>;
  if (post.scheduledAt && ["scheduled", "publishing", "failed"].includes(post.status)) return <>Scheduled for <time dateTime={post.scheduledAt.toISOString()}>{formatDate(post.scheduledAt, timeZone)}</time></>;
  return <>Created <time dateTime={post.createdAt.toISOString()}>{formatDate(post.createdAt, timeZone)}</time></>;
}

function flagsFor(post: ListPost, context: ListContext): RowActionFlags {
  const canEdit = context.isManager || post.authorId === context.userId;
  const draftLike = (post.status === "draft" || post.status === "rejected") && !post.publishedAt;
  const hasRemote = post.targets.some(row => row.remotePostId);
  const seen = new Set<string>();
  const channelNames = post.targets.filter(({ target }) => !seen.has(target.id) && seen.add(target.id)).map(({ target }) => target.name);
  return {
    id: post.id,
    excerpt: post.message.trim().slice(0, 120) || "Post without text",
    editable: canEdit && draftLike && !hasRemote,
    canPublishNow: canEdit && context.canPublish && post.status === "draft" && !post.publishedAt && post.targets.length > 0,
    canSubmit: canEdit && draftLike && post.targets.length > 0,
    canCancel: canEdit && post.status === "scheduled",
    canSync: hasRemote && canEdit,
    canDelete: canEdit && context.isAuthor,
    canDeleteRemote: context.isManager,
    channelNames,
    remote: post.targets.filter(row => row.remotePostId).map(row => ({ channel: row.target.name, platform: (row.target.socialAccount?.provider ? context.labels[row.target.socialAccount.provider]?.name : undefined) ?? "its platform" })),
  };
}

/** Posts as readable cards: excerpt, media, channels, status, time, and the actions the viewer may take. */
export function PostList({ posts, context, caption }: { posts: ListPost[]; context: ListContext; caption: string }) {
  return <ul className={styles.postList} aria-label={caption}>
    {posts.map(post => {
      const flags = flagsFor(post, context);
      const needsReview = post.targets.some(row => row.status === "processing" && !row.remotePostId);
      const hasActions = context.isAuthor && (flags.editable || flags.canPublishNow || flags.canSubmit || flags.canCancel || flags.canSync || flags.canDelete);
      return <li key={post.id} className={styles.postCard}>
        <Thumb post={post} />
        <div className={styles.postBody}>
          <p className={styles.postText}>{post.message.trim() || "No text included"}</p>
          <PlatformChannels post={post} labels={context.labels} />
          <div className={styles.postMeta}>
            <StatusChip status={post.status} />
            <span>{whenLabel(post, context.timeZone)}</span>
          </div>
          {needsReview ? <p className="ui-notice ui-notice--warning">A publish result needs checking on the platform before this can be retried.</p> : null}
        </div>
        <div className={styles.postActions}>
          {hasActions ? <PostRowActions post={flags} mode={context.mode} /> : context.isAuthor ? <span className={styles.noActions}>Only the author or a workspace manager can change this post.</span> : null}
        </div>
      </li>;
    })}
  </ul>;
}
