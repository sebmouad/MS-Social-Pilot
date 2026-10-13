import {
  NATIVE_SCHEDULE_MAX_SECONDS,
  NATIVE_SCHEDULE_MIN_SECONDS,
  type TargetType,
} from '../constants';
import { GraphError, graphRequest, graphResumableUpload, graphUpload } from './graph';

/**
 * Turning a composed post into Graph API calls.
 *
 * Facebook has no single "create a post" endpoint — the edge depends on the
 * attachments:
 *
 *   text / link          → POST /{target}/feed
 *   one photo            → POST /{target}/photos
 *   several photos       → N × POST /{target}/photos (unpublished)
 *                          then POST /{target}/feed with attached_media
 *   video                → POST /{target}/videos
 *   reel                 → POST /{page}/video_reels (start), upload, (finish)
 *   story, photo         → POST /{page}/photos (unpublished), /{page}/photo_stories
 *   story, video         → POST /{page}/video_stories (start), upload, (finish)
 *
 * The routing lives in {@link planPublish}, a pure function, so the decision
 * table is testable without touching the network.
 */

/**
 * A file to be uploaded, opened only when it is about to be sent.
 *
 * `read` rather than a `Buffer`: Graph takes one file per request and this code
 * uploads them one at a time, so holding all ten of a post's attachments at
 * once costs ten times what the upload actually needs — multiplied again by the
 * destinations the worker publishes to in parallel.
 */
export interface BinarySource {
  type: 'binary';
  read: () => Promise<Buffer>;
  filename: string;
  contentType: string;
}

export type MediaSource = { type: 'url'; url: string } | BinarySource;

/** Media already resolved to something Graph can consume. */
export type ResolvedMedia =
  | {
      kind: 'image';
      source: MediaSource;
      /** What the picture shows, for screen readers. Sent as Facebook's custom alt text. */
      altText?: string;
    }
  | { kind: 'video'; source: MediaSource };

export interface PublishRequest {
  targetType: TargetType;
  /** The Page or Group id. */
  targetId: string;
  /** Page access token for Pages; the connected user's token for Groups. */
  accessToken: string;
  message: string;
  link?: string | null;
  media?: ResolvedMedia[];
  /**
   * When set, Facebook itself holds the post until this time
   * (`scheduled_publish_time`). Pages only.
   */
  scheduledPublishTime?: Date | null;
  /** A feed post (the default), a Reel or a Story. Pages only for the last two. */
  format?: PostFormat;
  /** A Facebook place (a Page id) to tag; used by feed and multi-photo posts. */
  place?: string | null;
}

export type PostFormat = 'post' | 'reel' | 'story';
export const POST_FORMATS: PostFormat[] = ['post', 'reel', 'story'];

export interface PublishResult {
  /** Facebook's post id, usually `<targetId>_<postId>`. */
  remotePostId: string;
  remoteUrl: string;
  /** True when Facebook is holding the post for later publication. */
  scheduled: boolean;
}

export type PublishPlan =
  | { strategy: 'feed' }
  | { strategy: 'single_photo' }
  | { strategy: 'multi_photo'; count: number }
  | { strategy: 'video' }
  | { strategy: 'reel' }
  | { strategy: 'story_photo' }
  | { strategy: 'story_video' };

/**
 * Decide which Graph edge to use, and reject combinations Facebook will not
 * accept. Pure and exported so the rules can be tested directly.
 */
export function planPublish(request: PublishRequest): PublishPlan {
  const media = request.media ?? [];
  const images = media.filter((item) => item.kind === 'image');
  const videos = media.filter((item) => item.kind === 'video');

  if (videos.length > 1) {
    throw new GraphError({
      message: 'A post can contain at most one video.',
      kind: 'invalid_request',
    });
  }
  if (videos.length === 1 && images.length > 0) {
    throw new GraphError({
      message: 'A post cannot mix a video with photos. Publish them as separate posts.',
      kind: 'invalid_request',
    });
  }
  if (!request.message.trim() && !request.link && media.length === 0) {
    throw new GraphError({
      message: 'A post needs text, a link, or media.',
      kind: 'invalid_request',
    });
  }
  const format = request.format ?? 'post';
  if (format !== 'post') {
    if (request.targetType !== 'page') {
      throw new GraphError({ message: 'Reels and Stories can only go to a Facebook Page.', kind: 'invalid_request' });
    }
    if (request.scheduledPublishTime) {
      throw new GraphError({
        message: 'Facebook cannot hold a Reel or a Story for later. Let this app publish it at the time instead.',
        kind: 'invalid_request',
      });
    }
    if (format === 'reel') {
      if (videos.length !== 1 || images.length > 0) {
        throw new GraphError({ message: 'A Reel needs exactly one video.', kind: 'invalid_request' });
      }
      return { strategy: 'reel' };
    }
    if (media.length !== 1) {
      throw new GraphError({ message: 'A Story needs exactly one photo or one video.', kind: 'invalid_request' });
    }
    return { strategy: videos.length === 1 ? 'story_video' : 'story_photo' };
  }
  if (videos.length === 1) return { strategy: 'video' };
  if (images.length === 1) return { strategy: 'single_photo' };
  if (images.length > 1) return { strategy: 'multi_photo', count: images.length };
  return { strategy: 'feed' };
}

/**
 * Validate a native (Facebook-held) schedule.
 *
 * Graph enforces a 10-minute floor and a 30-day ceiling, and returns an
 * opaque code 100 when violated — checking first produces a message the user
 * can act on.
 */
export function toScheduledPublishTime(when: Date, now: Date = new Date()): number {
  const deltaSeconds = Math.floor((when.getTime() - now.getTime()) / 1000);

  if (deltaSeconds < NATIVE_SCHEDULE_MIN_SECONDS) {
    throw new GraphError({
      message: 'Facebook requires scheduled posts to be at least 10 minutes in the future.',
      kind: 'invalid_request',
    });
  }
  if (deltaSeconds > NATIVE_SCHEDULE_MAX_SECONDS) {
    throw new GraphError({
      message: 'Facebook cannot hold a post more than 30 days ahead. Let this app schedule it instead.',
      kind: 'invalid_request',
    });
  }
  return Math.floor(when.getTime() / 1000);
}

/**
 * Build the form body for a feed post.
 *
 * `link` is passed through untouched so Facebook renders its own Open Graph
 * card; attaching a scraped image ourselves would produce a plain photo post
 * with a URL in the text instead of a clickable link card.
 */
export function buildFeedBody(request: {
  message: string;
  link?: string | null;
  scheduledPublishTime?: Date | null;
  attachedMediaIds?: string[];
  place?: string | null;
  now?: Date;
}): Record<string, string | number | boolean | object> {
  const body: Record<string, string | number | boolean | object> = {};

  if (request.message.trim()) body.message = request.message;
  if (request.link) body.link = request.link;
  if (request.place) body.place = request.place;

  request.attachedMediaIds?.forEach((mediaId, index) => {
    // Graph expects indexed fields: attached_media[0], attached_media[1], …
    body[`attached_media[${index}]`] = { media_fbid: mediaId };
  });

  if (request.scheduledPublishTime) {
    body.published = false;
    body.scheduled_publish_time = toScheduledPublishTime(request.scheduledPublishTime, request.now);
  }
  return body;
}

/**
 * The text of a post whose attachment is media rather than a link card.
 *
 * The photos and videos edges have no `link` field, and a feed post with
 * `attached_media` drops it, so a link (often carrying UTM parameters) would
 * vanish without a trace. Putting it in the text keeps it clickable — Facebook
 * auto-links URLs in captions. Skipped when the author already wrote it there.
 */
export function buildMediaCaption(message: string, link?: string | null): string {
  const text = message.trim() ? message : '';
  if (!link || text.includes(link)) return text;
  return text ? `${text}\n\n${link}` : link;
}

/**
 * Public permalink for an uploaded video.
 *
 * The videos edge returns a bare video id, which is not a post id: Page
 * videos live under `/{page}/videos/{id}/`. Groups have no such path, and a
 * video id in the group post form is a dead link, so their videos use the
 * bare-id form, which Facebook resolves for any video.
 */
export function buildVideoPermalink(targetType: TargetType, targetId: string, videoId: string): string {
  return targetType === 'group'
    ? `https://www.facebook.com/${videoId}`
    : `https://www.facebook.com/${targetId}/videos/${videoId}/`;
}

/** Public permalink for a created post. */
export function buildPermalink(targetType: TargetType, targetId: string, remotePostId: string): string {
  // Graph returns "<targetId>_<postId>" for feed posts; photos return a bare id.
  const suffix = remotePostId.includes('_') ? remotePostId.split('_')[1] ?? remotePostId : remotePostId;

  return targetType === 'group'
    ? `https://www.facebook.com/groups/${targetId}/posts/${suffix}/`
    : `https://www.facebook.com/${targetId}/posts/${suffix}/`;
}

interface PhotoResponse {
  id: string;
  /** Present when the photo created a feed story. */
  post_id?: string;
}

/** Upload one photo, optionally unpublished so it can be attached to a feed post. */
async function uploadPhoto(
  request: PublishRequest,
  item: Extract<ResolvedMedia, { kind: 'image' }>,
  fields: Record<string, string | number | boolean | object | undefined>,
): Promise<PhotoResponse> {
  // Without it Facebook writes its own guess ("May be an image of…"), which is
  // rarely what the person who chose the picture would say.
  const altText = item.altText?.trim();
  if (altText) fields = { ...fields, alt_text_custom: altText };

  if (item.source.type === 'url') {
    const { data } = await graphRequest<PhotoResponse>(`${request.targetId}/photos`, {
      method: 'POST',
      accessToken: request.accessToken,
      body: { ...fields, url: item.source.url },
    });
    return data;
  }

  return graphUpload<PhotoResponse>(`${request.targetId}/photos`, {
    accessToken: request.accessToken,
    file: {
      data: await item.source.read(),
      filename: item.source.filename,
      contentType: item.source.contentType,
    },
    fields,
  });
}

/**
 * Publish a post to a Page or Group.
 *
 * Failure semantics: multi-photo publishing uploads each photo before creating
 * the story, so a failure part-way through leaves orphaned unpublished photos.
 * They are uploaded with `temporary=true`, which tells Facebook to expire them
 * on its own — cleaning up by hand would need another round of API calls that
 * can themselves fail.
 */
export async function publishPost(request: PublishRequest): Promise<PublishResult> {
  const plan = planPublish(request);
  const scheduled = Boolean(request.scheduledPublishTime);

  if (scheduled && request.targetType === 'group') {
    throw new GraphError({
      message: 'Facebook does not support native scheduling for Groups. Use the built-in scheduler instead.',
      kind: 'invalid_request',
    });
  }

  switch (plan.strategy) {
    case 'feed': {
      const { data } = await graphRequest<{ id: string }>(`${request.targetId}/feed`, {
        method: 'POST',
        accessToken: request.accessToken,
        body: buildFeedBody({
          message: request.message,
          link: request.link,
          place: request.place,
          scheduledPublishTime: request.scheduledPublishTime,
        }),
      });
      return {
        remotePostId: data.id,
        remoteUrl: buildPermalink(request.targetType, request.targetId, data.id),
        scheduled,
      };
    }

    case 'single_photo': {
      const image = (request.media ?? []).find(
        (item): item is Extract<ResolvedMedia, { kind: 'image' }> => item.kind === 'image',
      )!;

      const fields: Record<string, string | number | boolean | undefined> = {};
      const caption = buildMediaCaption(request.message, request.link);
      if (caption) fields.message = caption;
      if (request.scheduledPublishTime) {
        fields.published = false;
        fields.scheduled_publish_time = toScheduledPublishTime(request.scheduledPublishTime);
      }

      const photo = await uploadPhoto(request, image, fields);
      const postId = photo.post_id ?? photo.id;
      return {
        remotePostId: postId,
        remoteUrl: buildPermalink(request.targetType, request.targetId, postId),
        scheduled,
      };
    }

    case 'multi_photo': {
      const images = (request.media ?? []).filter(
        (item): item is Extract<ResolvedMedia, { kind: 'image' }> => item.kind === 'image',
      );

      const mediaIds: string[] = [];
      for (const image of images) {
        // Unpublished + temporary: these exist only to be attached below.
        const photo = await uploadPhoto(request, image, { published: false, temporary: true });
        mediaIds.push(photo.id);
      }

      const { data } = await graphRequest<{ id: string }>(`${request.targetId}/feed`, {
        method: 'POST',
        accessToken: request.accessToken,
        body: buildFeedBody({
          // Graph ignores `link` once media is attached; see buildMediaCaption.
          message: buildMediaCaption(request.message, request.link),
          scheduledPublishTime: request.scheduledPublishTime,
          attachedMediaIds: mediaIds,
          place: request.place,
        }),
      });
      return {
        remotePostId: data.id,
        remoteUrl: buildPermalink(request.targetType, request.targetId, data.id),
        scheduled,
      };
    }

    case 'video': {
      const video = (request.media ?? []).find(
        (item): item is Extract<ResolvedMedia, { kind: 'video' }> => item.kind === 'video',
      )!;

      const fields: Record<string, string | number | boolean | undefined> = {};
      const caption = buildMediaCaption(request.message, request.link);
      if (caption) fields.description = caption;
      if (request.scheduledPublishTime) {
        fields.published = false;
        fields.scheduled_publish_time = toScheduledPublishTime(request.scheduledPublishTime);
      }

      if (video.source.type === 'url') {
        const { data } = await graphRequest<{ id: string }>(`${request.targetId}/videos`, {
          method: 'POST',
          accessToken: request.accessToken,
          body: { ...fields, file_url: video.source.url },
        });
        return {
          remotePostId: data.id,
          remoteUrl: buildVideoPermalink(request.targetType, request.targetId, data.id),
          scheduled,
        };
      }

      const data = await graphUpload<{ id: string }>(`${request.targetId}/videos`, {
        accessToken: request.accessToken,
        file: {
          data: await video.source.read(),
          filename: video.source.filename,
          contentType: video.source.contentType,
        },
        fields,
      });
      return {
        remotePostId: data.id,
        remoteUrl: buildVideoPermalink(request.targetType, request.targetId, data.id),
        scheduled,
      };
    }

    case 'reel': {
      const video = onlyMedia(request, 'video');
      const caption = buildMediaCaption(request.message, request.link);
      const videoId = await uploadThroughPhases(`${request.targetId}/video_reels`, request.accessToken, video);
      await graphRequest(`${request.targetId}/video_reels`, {
        method: 'POST',
        accessToken: request.accessToken,
        body: {
          upload_phase: 'finish',
          video_id: videoId,
          video_state: 'PUBLISHED',
          ...(caption ? { description: caption } : {}),
        },
      });
      return { remotePostId: videoId, remoteUrl: `https://www.facebook.com/reel/${videoId}`, scheduled: false };
    }

    case 'story_photo': {
      const image = onlyMedia(request, 'image');
      const photo = await uploadPhoto(request, image, { published: false });
      const { data } = await graphRequest<{ post_id?: string; id?: string }>(`${request.targetId}/photo_stories`, {
        method: 'POST',
        accessToken: request.accessToken,
        body: { photo_id: photo.id },
      });
      const postId = data.post_id ?? data.id ?? photo.id;
      return { remotePostId: postId, remoteUrl: storyUrl(request.targetId), scheduled: false };
    }

    case 'story_video': {
      const video = onlyMedia(request, 'video');
      const videoId = await uploadThroughPhases(`${request.targetId}/video_stories`, request.accessToken, video);
      const { data } = await graphRequest<{ post_id?: string }>(`${request.targetId}/video_stories`, {
        method: 'POST',
        accessToken: request.accessToken,
        body: { upload_phase: 'finish', video_id: videoId },
      });
      return { remotePostId: data.post_id ?? videoId, remoteUrl: storyUrl(request.targetId), scheduled: false };
    }
  }
}

/** The one attachment of the kind a Reel or a Story is made of. */
function onlyMedia<K extends ResolvedMedia['kind']>(request: PublishRequest, kind: K): Extract<ResolvedMedia, { kind: K }> {
  return (request.media ?? []).find((item): item is Extract<ResolvedMedia, { kind: K }> => item.kind === kind)!;
}

/**
 * Start a resumable video upload on `edge`, send the file to the address it
 * gives back, and return the video's id for the finish phase.
 */
async function uploadThroughPhases(
  edge: string,
  accessToken: string,
  video: Extract<ResolvedMedia, { kind: 'video' }>,
): Promise<string> {
  const { data } = await graphRequest<{ video_id: string; upload_url: string }>(edge, {
    method: 'POST',
    accessToken,
    body: { upload_phase: 'start' },
  });
  if (video.source.type === 'url') {
    await graphResumableUpload(data.upload_url, { accessToken, fileUrl: video.source.url });
  } else {
    await graphResumableUpload(data.upload_url, {
      accessToken,
      data: await video.source.read(),
      filename: video.source.filename,
    });
  }
  return data.video_id;
}

/** Stories have no permalink of their own; the Page's stories are where they show. */
function storyUrl(pageId: string): string {
  return `https://www.facebook.com/stories/${pageId}`;
}

/**
 * What Facebook currently thinks of a post we handed it.
 *
 * `is_published` is the whole point: a natively scheduled post exists on
 * Facebook from the moment it is created, and only flips to published when the
 * scheduled time arrives. Nothing tells us when that happens, so the only way
 * to know is to ask.
 */
export interface RemotePostState {
  isPublished: boolean | null;
  /** When Facebook says it went out, if it says. */
  createdTime: Date | null;
}

export async function fetchRemotePostState(
  remotePostId: string,
  accessToken: string,
): Promise<RemotePostState> {
  const { data } = await graphRequest<Record<string, unknown>>(remotePostId, {
    accessToken,
    essential: true,
    params: { fields: 'is_published,created_time' },
  });

  const raw = typeof data.created_time === 'string' ? new Date(data.created_time) : null;

  return {
    isPublished: typeof data.is_published === 'boolean' ? data.is_published : null,
    // Facebook moves `created_time` to the publication moment for a scheduled
    // post, but an unparseable value must not become an Invalid Date on a row.
    createdTime: raw && !Number.isNaN(raw.getTime()) ? raw : null,
  };
}

/** Delete a published post. Used by "delete from Facebook too". */
export async function deleteRemotePost(remotePostId: string, accessToken: string): Promise<void> {
  await graphRequest(remotePostId, { method: 'DELETE', accessToken });
}
