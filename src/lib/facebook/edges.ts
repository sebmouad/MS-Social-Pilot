import { graphPaged, graphRequest } from './graph';

/**
 * Graph edges that are not `/insights`.
 *
 * Insights answer "how many". These answer "who and what": the comment text,
 * the star rating, the message thread, the posts nobody scheduled through this
 * app. Each returns plain data — persistence and permission handling belong to
 * the service layer, so these stay testable against a mock Graph.
 *
 * Every one of them pages, and every one caps the number of pages. A Page with
 * six years of comments must not be able to hold a worker job open forever.
 */

/** Hard ceilings, chosen so one sync of one destination stays bounded. */
const MAX_COMMENT_PAGES = 5;
const MAX_REVIEW_PAGES = 5;
const MAX_CONVERSATION_PAGES = 3;
const MAX_POST_PAGES = 5;
const MAX_VIDEO_PAGES = 3;
const PAGE_SIZE = 100;

export interface GraphComment {
  remoteId: string;
  parentRemoteId: string | null;
  message: string;
  fromName: string | null;
  fromId: string | null;
  likeCount: number;
  replyCount: number;
  isHidden: boolean;
  createdTime: Date;
}

interface RawComment {
  id: string;
  message?: string;
  created_time?: string;
  like_count?: number;
  is_hidden?: boolean;
  from?: { id?: string; name?: string };
  parent?: { id?: string };
  comment_count?: number;
}

function toDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Comments on a post, replies included.
 *
 * `filter=stream` flattens the thread so replies arrive alongside top-level
 * comments with a `parent` set, which is one request instead of one per thread.
 * `from` is only populated when the app has the Page-level permissions for it,
 * so the name is optional rather than assumed.
 */
export async function fetchComments(
  postId: string,
  accessToken: string,
  options: { since?: Date; signal?: AbortSignal } = {},
): Promise<GraphComment[]> {
  const raw = await graphPaged<RawComment>(`${postId}/comments`, {
    accessToken,
    maxPages: MAX_COMMENT_PAGES,
    limit: PAGE_SIZE,
    signal: options.signal,
    params: {
      filter: 'stream',
      order: 'chronological',
      fields: 'id,message,created_time,like_count,is_hidden,comment_count,from{id,name},parent{id}',
      since: options.since ? Math.floor(options.since.getTime() / 1000) : undefined,
    },
  });

  return raw
    .map((entry) => {
      const createdTime = toDate(entry.created_time);
      if (!createdTime) return null;
      return {
        remoteId: entry.id,
        parentRemoteId: entry.parent?.id ?? null,
        message: entry.message ?? '',
        fromName: entry.from?.name ?? null,
        fromId: entry.from?.id ?? null,
        likeCount: entry.like_count ?? 0,
        replyCount: entry.comment_count ?? 0,
        isHidden: entry.is_hidden ?? false,
        createdTime,
      } satisfies GraphComment;
    })
    .filter((comment): comment is GraphComment => comment !== null);
}

export interface GraphReview {
  remoteId: string;
  reviewerName: string | null;
  rating: number | null;
  recommendationType: string | null;
  reviewText: string | null;
  createdTime: Date;
}

interface RawReview {
  open_graph_story?: { id?: string };
  reviewer?: { id?: string; name?: string };
  rating?: number;
  recommendation_type?: string;
  review_text?: string;
  created_time?: string;
}

/**
 * Ratings left on a Page.
 *
 * Facebook replaced stars with a yes/no recommendation in 2018, so a Page can
 * return either shape — sometimes both, on Pages old enough to have history
 * from before the change. The rating is kept optional rather than derived from
 * the recommendation, because "recommends" is not four stars.
 *
 * There is no stable id on the rating itself; the story id is what identifies
 * it, and a rating without one is skipped rather than given a synthetic key
 * that would duplicate on the next sync.
 */
export async function fetchReviews(
  pageId: string,
  accessToken: string,
  options: { signal?: AbortSignal } = {},
): Promise<GraphReview[]> {
  const raw = await graphPaged<RawReview>(`${pageId}/ratings`, {
    accessToken,
    maxPages: MAX_REVIEW_PAGES,
    limit: PAGE_SIZE,
    signal: options.signal,
    params: {
      fields: 'created_time,rating,recommendation_type,review_text,reviewer{id,name},open_graph_story{id}',
    },
  });

  return raw
    .map((entry) => {
      const createdTime = toDate(entry.created_time);
      const remoteId = entry.open_graph_story?.id;
      if (!createdTime || !remoteId) return null;
      return {
        remoteId,
        reviewerName: entry.reviewer?.name ?? null,
        rating: typeof entry.rating === 'number' ? entry.rating : null,
        recommendationType: entry.recommendation_type ?? null,
        reviewText: entry.review_text ?? null,
        createdTime,
      } satisfies GraphReview;
    })
    .filter((review): review is GraphReview => review !== null);
}

export interface GraphConversationMessage {
  remoteId: string;
  fromName: string | null;
  fromId: string | null;
  message: string | null;
  createdTime: Date;
}

export interface GraphConversation {
  remoteId: string;
  snippet: string | null;
  unreadCount: number;
  messageCount: number;
  participants: string[];
  updatedTime: Date;
  messages: GraphConversationMessage[];
}

interface RawConversation {
  id: string;
  snippet?: string;
  unread_count?: number;
  message_count?: number;
  updated_time?: string;
  participants?: { data?: Array<{ id?: string; name?: string; email?: string }> };
  messages?: {
    data?: Array<{
      id: string;
      message?: string;
      created_time?: string;
      from?: { id?: string; name?: string };
    }>;
  };
}

/** How many messages to pull per thread. The inbox view shows recent activity. */
const MESSAGES_PER_THREAD = 25;

/**
 * Page inbox threads with their most recent messages.
 *
 * Needs `pages_messaging` and `pages_read_engagement`; without them Graph
 * returns a permission error, which the caller reports rather than swallows —
 * an empty inbox and an inbox we are not allowed to read are different facts.
 */
export async function fetchConversations(
  pageId: string,
  accessToken: string,
  options: { signal?: AbortSignal } = {},
): Promise<GraphConversation[]> {
  const raw = await graphPaged<RawConversation>(`${pageId}/conversations`, {
    accessToken,
    maxPages: MAX_CONVERSATION_PAGES,
    limit: 50,
    signal: options.signal,
    params: {
      fields:
        'id,snippet,unread_count,message_count,updated_time,participants,' +
        `messages.limit(${MESSAGES_PER_THREAD}){id,message,created_time,from}`,
    },
  });

  return raw
    .map((entry) => {
      const updatedTime = toDate(entry.updated_time);
      if (!updatedTime) return null;

      const messages = (entry.messages?.data ?? [])
        .map((message) => {
          const createdTime = toDate(message.created_time);
          if (!createdTime) return null;
          return {
            remoteId: message.id,
            fromName: message.from?.name ?? null,
            fromId: message.from?.id ?? null,
            message: message.message ?? null,
            createdTime,
          } satisfies GraphConversationMessage;
        })
        .filter((message): message is GraphConversationMessage => message !== null);

      return {
        remoteId: entry.id,
        snippet: entry.snippet ?? null,
        unreadCount: entry.unread_count ?? 0,
        messageCount: entry.message_count ?? messages.length,
        participants: (entry.participants?.data ?? [])
          .map((person) => person.name)
          .filter((name): name is string => Boolean(name)),
        updatedTime,
        messages,
      } satisfies GraphConversation;
    })
    .filter((conversation): conversation is GraphConversation => conversation !== null);
}

export interface GraphPublishedPost {
  remoteId: string;
  message: string | null;
  permalink: string | null;
  statusType: string | null;
  createdTime: Date;
}

interface RawPublishedPost {
  id: string;
  message?: string;
  story?: string;
  permalink_url?: string;
  status_type?: string;
  created_time?: string;
}

/**
 * Everything published on the Page, however it got there.
 *
 * This is the reconciliation edge: posts made from the Facebook app, by another
 * tool, or by a colleague who did not use this product are invisible to us
 * otherwise, and every Page-level report that ignores them understates the
 * Page. Posts this app published come back here too — the caller matches on
 * remote id and keeps only the rest.
 */
export async function fetchPublishedPosts(
  pageId: string,
  accessToken: string,
  options: { since?: Date; until?: Date; signal?: AbortSignal } = {},
): Promise<GraphPublishedPost[]> {
  const raw = await graphPaged<RawPublishedPost>(`${pageId}/published_posts`, {
    accessToken,
    maxPages: MAX_POST_PAGES,
    limit: PAGE_SIZE,
    signal: options.signal,
    params: {
      fields: 'id,message,story,permalink_url,status_type,created_time',
      since: options.since ? Math.floor(options.since.getTime() / 1000) : undefined,
      until: options.until ? Math.floor(options.until.getTime() / 1000) : undefined,
    },
  });

  return raw
    .map((entry) => {
      const createdTime = toDate(entry.created_time);
      if (!createdTime) return null;
      return {
        remoteId: entry.id,
        // A share or a life event has no message, only Facebook's own `story`
        // text. Showing that beats showing an empty row.
        message: entry.message ?? entry.story ?? null,
        permalink: entry.permalink_url ?? null,
        statusType: entry.status_type ?? null,
        createdTime,
      } satisfies GraphPublishedPost;
    })
    .filter((post): post is GraphPublishedPost => post !== null);
}

export interface GraphVideo {
  remoteId: string;
  title: string | null;
  description: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  lengthSeconds: number | null;
  createdTime: Date;
}

interface RawVideo {
  id: string;
  title?: string;
  description?: string;
  permalink_url?: string;
  picture?: string;
  length?: number;
  created_time?: string;
}

/** Videos uploaded to a Page, which the video-level catalogue is read against. */
export async function fetchPageVideos(
  pageId: string,
  accessToken: string,
  options: { signal?: AbortSignal } = {},
): Promise<GraphVideo[]> {
  const raw = await graphPaged<RawVideo>(`${pageId}/videos`, {
    accessToken,
    maxPages: MAX_VIDEO_PAGES,
    limit: 50,
    signal: options.signal,
    params: {
      // `uploaded` excludes videos merely shared onto the Page, which have no
      // insights of their own.
      type: 'uploaded',
      fields: 'id,title,description,permalink_url,picture,length,created_time',
    },
  });

  return raw
    .map((entry) => {
      const createdTime = toDate(entry.created_time);
      if (!createdTime) return null;
      return {
        remoteId: entry.id,
        title: entry.title ?? null,
        description: entry.description ?? null,
        permalink: entry.permalink_url ?? null,
        thumbnailUrl: entry.picture ?? null,
        lengthSeconds: typeof entry.length === 'number' ? entry.length : null,
        createdTime,
      } satisfies GraphVideo;
    })
    .filter((video): video is GraphVideo => video !== null);
}

/**
 * Hide or unhide a comment.
 *
 * The one write in this file, and the reason the comments table earns its
 * keep: reading comments without being able to act on them is a report, not
 * moderation.
 */
export async function setCommentHidden(
  commentId: string,
  accessToken: string,
  hidden: boolean,
): Promise<void> {
  await graphRequest(commentId, {
    accessToken,
    method: 'POST',
    body: { is_hidden: hidden },
  });
}

/** Delete a comment. Irreversible on Facebook's side. */
export async function deleteComment(commentId: string, accessToken: string): Promise<void> {
  await graphRequest(commentId, { accessToken, method: 'DELETE' });
}

/** Reply to a comment as the Page. */
export async function replyToComment(
  commentId: string,
  accessToken: string,
  message: string,
): Promise<string> {
  const { data } = await graphRequest<{ id: string }>(`${commentId}/comments`, {
    accessToken,
    method: 'POST',
    body: { message },
  });
  return data.id;
}
