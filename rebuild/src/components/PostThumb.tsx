'use client';
import { useState } from 'react';
import { IconPhoto, IconPlayerPlayFilled } from '@tabler/icons-react';
import type { PostThumbnail } from './post-thumbnail';

type Props = {
  thumb: PostThumbnail | null;
  size?: 'sm' | 'md' | 'lg';
  /** Spoken name when the image is missing; omit when adjacent text already describes the post. */
  label?: string;
};

/**
 * Square post thumbnail: the image or video poster, a play mark for video, a "+n" count for
 * further attachments, and a quiet icon tile when there is no media or the file fails to load.
 * Size comes from the --post-thumb-* tokens.
 */
export function PostThumb({ thumb, size = 'md', label }: Props) {
  const [failed, setFailed] = useState<string | null>(null);
  const url = thumb?.url && failed !== thumb.url ? thumb.url : null;
  const named = !url && !!label;
  return <span className="ui-post-thumb" data-size={size} data-empty={url ? undefined : true} data-video={thumb?.video || undefined} role={named ? 'img' : undefined} aria-label={named ? label : undefined} aria-hidden={!url && !label ? true : undefined}>
    {url
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={url} alt="" loading="lazy" onError={() => setFailed(url)} />
      : thumb?.video ? <IconPlayerPlayFilled size={18} aria-hidden="true" /> : <IconPhoto size={18} stroke={1.6} aria-hidden="true" />}
    {url && thumb?.video ? <span className="ui-post-thumb__play" aria-hidden="true"><IconPlayerPlayFilled size={12} /></span> : null}
    {thumb && thumb.count > 1 ? <span className="ui-post-thumb__count" aria-hidden="true">+{thumb.count - 1}</span> : null}
  </span>;
}
