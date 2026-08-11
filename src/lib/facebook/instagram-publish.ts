import { GraphError, graphRequest } from './graph';

/**
 * Publishing to Instagram, which is not publishing to Facebook.
 *
 * Three differences shape everything here:
 *
 * 1. **No upload.** Every other edge in this codebase hands Graph a file.
 *    Instagram takes a URL and fetches it itself, from the public internet,
 *    with nothing to authenticate as. See `src/lib/media-links.ts` for the
 *    short-lived signed link that exists for exactly this fetch.
 *
 * 2. **Two steps, not one.** You create a *container* describing the post,
 *    then publish the container. Between them Facebook downloads and processes
 *    the file, which for video takes long enough that the container has a
 *    status you have to wait on.
 *
 * 3. **Media is not optional.** Instagram has no text-only post. A caption
 *    with nothing attached is not a smaller post, it is not a post.
 *
 * A carousel is the same shape one level deeper: a container per child, then a
 * container holding the children, then one publish.
 */

/** What Instagram will accept in one post. */
export const IG_LIMITS = {
  captionLength: 2200,
  /** Instagram's own carousel maximum. */
  carouselMax: 10,
  carouselMin: 2,
} as const;

export interface IgPublishMedia {
  kind: 'image' | 'video';
  /** Publicly fetchable, because Facebook does the fetching. */
  url: string;
}

export interface IgPublishRequest {
  igUserId: string;
  accessToken: string;
  caption: string;
  media: IgPublishMedia[];
}

export type IgPublishPlan =
  | { strategy: 'image' }
  | { strategy: 'video' }
  | { strategy: 'carousel'; count: number };

/**
 * Decide the shape of the post, and reject what Instagram will not take.
 *
 * Pure and exported, like `planPublish` for Facebook, so the rules can be read
 * and tested without a network.
 */
export function planInstagramPublish(request: IgPublishRequest): IgPublishPlan {
  const media = request.media;

  if (media.length === 0) {
    throw new GraphError({
      message:
        'Instagram has no text-only post. Add a photo or a video, or send this one to Facebook instead.',
      kind: 'invalid_request',
    });
  }

  if (request.caption.length > IG_LIMITS.captionLength) {
    throw new GraphError({
      message: `An Instagram caption cannot be longer than ${IG_LIMITS.captionLength} characters.`,
      kind: 'invalid_request',
    });
  }

  if (media.length > IG_LIMITS.carouselMax) {
    throw new GraphError({
      message: `An Instagram carousel holds at most ${IG_LIMITS.carouselMax} items.`,
      kind: 'invalid_request',
    });
  }

  if (media.length === 1) {
    return media[0]!.kind === 'video' ? { strategy: 'video' } : { strategy: 'image' };
  }

  return { strategy: 'carousel', count: media.length };
}

/** How the container's `status_code` field reads while Facebook works. */
type ContainerStatus = 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED';

export interface IgPublishResult {
  /** The published media's id. */
  remotePostId: string;
  remoteUrl: string;
  scheduled: false;
}

export interface IgPublishOptions {
  /** How long to wait for Facebook to finish fetching and processing. */
  timeoutMs?: number;
  /** Injected so tests do not sleep. */
  wait?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 3_000;

async function createContainer(
  request: IgPublishRequest,
  fields: Record<string, string | boolean>,
  signal?: AbortSignal,
): Promise<string> {
  const { data } = await graphRequest<{ id: string }>(`${request.igUserId}/media`, {
    accessToken: request.accessToken,
    method: 'POST',
    signal,
    body: fields,
  });

  if (!data.id) {
    throw new GraphError({
      message: 'Instagram accepted the upload but returned no container to publish.',
      kind: 'transient',
    });
  }
  return data.id;
}

/**
 * Wait for a container to be ready, or explain why it never will be.
 *
 * An image is usually finished by the time this asks. A video is not: Facebook
 * downloads it, transcodes it, and only then accepts a publish. Publishing an
 * unfinished container fails with an error that says nothing useful, so the
 * wait belongs here where the reason is still in hand.
 */
async function awaitContainer(
  containerId: string,
  accessToken: string,
  options: IgPublishOptions,
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const wait = options.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const { data } = await graphRequest<{ status_code?: ContainerStatus; status?: string }>(
      containerId,
      {
        accessToken,
        signal: options.signal,
        params: { fields: 'status_code,status' },
      },
    );

    const status = data.status_code ?? 'IN_PROGRESS';

    if (status === 'FINISHED' || status === 'PUBLISHED') return;

    if (status === 'ERROR') {
      throw new GraphError({
        // Facebook's own note on the container says which rule the file broke —
        // aspect ratio, length, codec — and none of that is guessable here.
        message: `Instagram could not process the file: ${data.status ?? 'no reason given'}.`,
        kind: 'rejected',
      });
    }

    if (status === 'EXPIRED') {
      throw new GraphError({
        message: 'Instagram discarded the upload before it was published. Try again.',
        kind: 'transient',
      });
    }

    if (Date.now() >= deadline) {
      throw new GraphError({
        message:
          'Instagram is still processing this file. It may yet appear; check the account before sending it again.',
        kind: 'transient',
      });
    }

    await wait(POLL_INTERVAL_MS);
  }
}

/**
 * Create the containers, wait for them, and publish.
 *
 * Every container is waited on, including a carousel's children: publishing a
 * parent whose children are still being processed is the one way to get a
 * partial carousel, and Instagram will not let you fix it afterwards.
 */
export async function publishToInstagram(
  request: IgPublishRequest,
  options: IgPublishOptions = {},
): Promise<IgPublishResult> {
  const plan = planInstagramPublish(request);

  let creationId: string;

  if (plan.strategy === 'carousel') {
    const children: string[] = [];
    for (const item of request.media) {
      const child = await createContainer(
        request,
        {
          ...(item.kind === 'video'
            ? { video_url: item.url, media_type: 'VIDEO' }
            : { image_url: item.url }),
          is_carousel_item: true,
        },
        options.signal,
      );
      await awaitContainer(child, request.accessToken, options);
      children.push(child);
    }

    creationId = await createContainer(
      request,
      {
        media_type: 'CAROUSEL',
        children: children.join(','),
        caption: request.caption,
      },
      options.signal,
    );
  } else {
    const only = request.media[0]!;
    creationId = await createContainer(
      request,
      {
        ...(plan.strategy === 'video'
          ? // REELS rather than VIDEO: Instagram stopped accepting plain feed
            // video, and a container asking for it comes back as an error whose
            // text does not mention reels at all.
            { video_url: only.url, media_type: 'REELS' }
          : { image_url: only.url }),
        caption: request.caption,
      },
      options.signal,
    );
  }

  await awaitContainer(creationId, request.accessToken, options);

  const { data } = await graphRequest<{ id: string }>(`${request.igUserId}/media_publish`, {
    accessToken: request.accessToken,
    method: 'POST',
    signal: options.signal,
    body: { creation_id: creationId },
  });

  if (!data.id) {
    throw new GraphError({
      message: 'Instagram reported no post id after publishing.',
      kind: 'transient',
    });
  }

  return {
    remotePostId: data.id,
    remoteUrl: `https://www.instagram.com/p/${data.id}/`,
    scheduled: false,
  };
}
