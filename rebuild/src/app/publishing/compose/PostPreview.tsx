import { PlatformMark } from '@/components/ChannelChip';
import type { ComposeModule } from '@/lib/publishing/compose-rules';
import styles from './compose.module.css';

export type PreviewChannel = { id: string; name: string; pictureUrl: string | null; module: ComposeModule | null };

function hostOf(value: string) {
  try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/**
 * An approximate picture of the post. It uses the platform's name and badge but
 * not its look, and says so: each platform decides final layout and cropping.
 */
export function PostPreview({ channel, message, firstComment, link, imageSrc, imageAlt, videoUrl, when }: {
  channel: PreviewChannel | null;
  message: string;
  firstComment: string;
  link: string;
  imageSrc: string;
  imageAlt: string;
  videoUrl: string;
  when: string;
}) {
  const text = message.trim();
  const linkHost = hostOf(link.trim());
  const videoHost = hostOf(videoUrl.trim());
  const secureImage = imageSrc.startsWith('blob:') || imageSrc.startsWith('/api/media/') || imageSrc.startsWith('https://');
  return <section className={styles.preview} aria-label="Post preview">
    <div className={styles.previewHead}>
      <h2>Preview</h2>
      <span>{channel?.module ? `As it may appear on ${channel.module.name}` : 'Choose a channel to preview it'}</span>
    </div>
    <article className={styles.previewPost}>
      <header>
        <span className={styles.avatar} aria-hidden="true">{channel?.pictureUrl ? <img src={channel.pictureUrl} alt="" width={40} height={40} /> : (channel?.name ?? 'Your channel').trim().charAt(0).toUpperCase()}</span>
        <div>
          <strong>{channel?.name ?? 'Your channel'}</strong>
          <span className={styles.previewMeta}>{channel?.module ? <PlatformMark mark={channel.module.mark} /> : null}{channel?.module ? <span>{channel.module.name} · </span> : null}<span>{when}</span></span>
        </div>
      </header>
      {text ? <p className={`${styles.previewText}${text.length > 700 ? ` ${styles.previewClamp}` : ''}`}>{message}</p> : <p className={styles.previewPlaceholder}>Your text will appear here.</p>}
      {text.length > 700 ? <p className={styles.previewNote}>Long text is shortened in this preview. The full text is published.</p> : null}
      {secureImage && imageSrc ? <img className={styles.previewImage} src={imageSrc} alt={imageAlt || 'Attached image'} /> : null}
      {link.trim() && linkHost ? <div className={styles.previewLink}><span>{linkHost}</span><strong>{link.trim()}</strong><small>The platform reads the page to build its own link card.</small></div> : null}
      {videoUrl.trim() && videoHost ? <div className={styles.previewVideo}>
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="m10 8.5 6 3.5-6 3.5z" fill="currentColor" /></svg>
        <span>Video from {videoHost}</span>
      </div> : null}
    </article>
    {firstComment.trim() ? <div className={styles.previewComment}>
      <span>First comment</span>
      <p>{firstComment}</p>
    </div> : null}
    <p className={styles.previewNote}>This preview is approximate. Each platform decides its own layout, cropping and text shortening.</p>
  </section>;
}
