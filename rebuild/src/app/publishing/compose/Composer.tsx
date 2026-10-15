'use client';

import { useActionState, useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ModalDialog } from '@/components/ModalDialog';
import { allowedFormats, countStatus, firstCommentAllowed, formatProblem, modulesOf, textLimit, type AttachmentFormat, type ComposeModule } from '@/lib/publishing/compose-rules';
import { composePostAction } from './actions';
import { ChannelPicker, type PickerChannel } from './ChannelPicker';
import { MediaPickerDialog } from './MediaPickerDialog';
import { PostPreview } from './PostPreview';
import styles from './compose.module.css';

type AttachmentKind = 'none' | 'link' | 'image' | 'video' | 'keep';
type Intent = 'draft' | 'schedule' | 'publish' | 'approval';

export type ComposerInitial = {
  postId: string; message: string; firstComment: string; targetIds: string[];
  attachmentKind: AttachmentKind; link: string; imageRef: string; imageUrl: string; altText: string; videoUrl: string; keptCount: number;
};
type Rules = { maxText: number; maxTargets: number; maxAlt: number; maxUploadBytes: number; mimeTypes: string[] };

const FORMAT_LABEL: Record<AttachmentFormat, string> = { link: 'Link', image: 'Image', video: 'Video' };
const INTENTS: Array<{ id: Intent; label: string; hint: string; needsChannel: boolean; action: string }> = [
  { id: 'publish', label: 'Publish now', hint: 'It goes out right away to the selected channels.', needsChannel: true, action: 'Publish now' },
  { id: 'schedule', label: 'Schedule', hint: 'Pick a date and time. It is added to the queue.', needsChannel: true, action: 'Schedule post' },
  { id: 'draft', label: 'Save as draft', hint: 'Keep it here and finish it later.', needsChannel: false, action: 'Save draft' },
  { id: 'approval', label: 'Submit for approval', hint: 'A reviewer approves it before it can be published.', needsChannel: true, action: 'Submit for approval' },
];

function isHttps(value: string) {
  try { const url = new URL(value.trim()); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}
function mediaUrl(reference: string) { return `/api/media/${encodeURIComponent(reference.replace(/^media:/, ''))}`; }

export function Composer({ channels, modules, initial, rules, timeZone, timeZoneLabel, nowLocal, canConnect, canBrowseLibrary, canUpload }: {
  channels: PickerChannel[]; modules: ComposeModule[]; initial: ComposerInitial | null; rules: Rules;
  timeZone: string; timeZoneLabel: string; nowLocal: string; canConnect: boolean; canBrowseLibrary: boolean; canUpload: boolean;
}) {
  const ids = useId();
  const available = useMemo(() => new Set(channels.map(channel => channel.id)), [channels]);
  const startTargets = useMemo(() => (initial?.targetIds ?? []).filter(id => available.has(id)), [initial, available]);
  const droppedChannels = (initial?.targetIds.length ?? 0) - startTargets.length;

  const [postId, setPostId] = useState(initial?.postId ?? '');
  const [message, setMessage] = useState(initial?.message ?? '');
  const [firstComment, setFirstComment] = useState(initial?.firstComment ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set(startTargets));
  const [kind, setKind] = useState<AttachmentKind>(initial?.attachmentKind ?? 'none');
  const [link, setLink] = useState(initial?.link ?? '');
  const [imageRef, setImageRef] = useState(initial?.imageRef ?? '');
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl ?? '');
  const [altText, setAltText] = useState(initial?.altText ?? '');
  const [videoUrl, setVideoUrl] = useState(initial?.videoUrl ?? '');
  const [intent, setIntent] = useState<Intent>('draft');
  const [scheduledLocal, setScheduledLocal] = useState('');
  const [previewId, setPreviewId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [leaveHref, setLeaveHref] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(composePostAction, null);

  const selectedChannels = channels.filter(channel => selected.has(channel.id));
  const selectedModules = modulesOf(selectedChannels.map(channel => channel.provider), modules);
  const limit = textLimit(selectedModules, rules.maxText);
  const count = countStatus(message, limit);
  const formats = allowedFormats(selectedModules);
  const currentFormat: AttachmentFormat | null = kind === 'link' || kind === 'image' || kind === 'video' ? kind : null;
  const formatError = formatProblem(currentFormat, selectedModules);
  const commentAllowed = firstCommentAllowed(selectedModules);
  const activeIntent = INTENTS.find(item => item.id === intent)!;
  const hasChannels = selected.size > 0;

  const snapshot = JSON.stringify({ message, firstComment, targets: [...selected].sort(), kind, link, imageRef, imageUrl, altText, videoUrl, scheduledLocal });
  const baseline = useRef(snapshot);
  const dirty = snapshot !== baseline.current;
  const submitting = useRef(false);
  const leaving = useRef(false);
  const guard = useRef(false);
  guard.current = dirty && !pending;

  // Keep the saved post's id after a failed follow-up step so a retry updates it rather than duplicating it.
  useEffect(() => {
    submitting.current = false;
    if (state?.postId && state.postId !== postId) {
      setPostId(state.postId);
      window.history.replaceState(null, '', `/publishing/compose?edit=${encodeURIComponent(state.postId)}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Leaving with unsaved work: browser prompt for reloads/closing, our own dialog for in-app links.
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!guard.current || submitting.current || leaving.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const onClick = (event: MouseEvent) => {
      if (!guard.current || submitting.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search)) return;
      event.preventDefault();
      setLeaveHref(url.pathname + url.search + url.hash);
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', onClick, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', onClick, true); };
  }, []);

  const previewChannelRaw = selectedChannels.find(channel => channel.id === previewId) ?? selectedChannels[0] ?? null;
  const previewChannel = previewChannelRaw ? { id: previewChannelRaw.id, name: previewChannelRaw.name, pictureUrl: previewChannelRaw.pictureUrl, module: modules.find(module => module.id === previewChannelRaw.provider) ?? null } : null;
  const when = intent === 'publish' ? 'Just now' : intent === 'schedule' ? (scheduledLocal ? `Scheduled for ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(`${scheduledLocal}:00Z`))}` : 'Scheduled') : intent === 'approval' ? 'Awaiting approval' : 'Draft';
  const imageSrc = kind === 'image' ? (imageRef ? mediaUrl(imageRef) : isHttps(imageUrl) ? imageUrl.trim() : '') : '';

  async function uploadFile(file: File) {
    setPickerOpen(false);
    setUploadError('');
    const types = rules.mimeTypes.map(type => type.replace('image/', '').toUpperCase()).join(', ');
    if (!rules.mimeTypes.includes(file.type)) { setUploadError(`Use an image in one of these formats: ${types}.`); return; }
    if (file.size > rules.maxUploadBytes) { setUploadError(`Images can be up to ${Math.floor(rules.maxUploadBytes / 1048576)} MB.`); return; }
    setUploading(true);
    try {
      const body = new FormData();
      body.append('imageFile', file);
      const response = await fetch('/api/media', { method: 'POST', body });
      const result = await response.json().catch(() => ({})) as { reference?: string; error?: string };
      if (!response.ok || !result.reference) throw new Error(result.error || 'The image could not be uploaded. Please try again.');
      setImageRef(result.reference); setImageUrl(''); setKind('image');
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : 'The image could not be uploaded. Please try again.');
    } finally { setUploading(false); }
  }

  function validate() {
    const next: Record<string, string> = {};
    if (!message.trim()) next.message = 'Write the post text before saving.';
    else if (count.over) next.message = `The text is ${(-count.remaining).toLocaleString()} characters over the ${limit.toLocaleString()} the selected channels accept. Shorten it.`;
    if (intent !== 'draft' && !hasChannels) next.channels = 'Choose at least one channel to publish, schedule, or submit this post.';
    if (intent === 'schedule') {
      if (!scheduledLocal) next.scheduledLocal = 'Choose the date and time to publish.';
      else if (scheduledLocal <= nowLocal) next.scheduledLocal = 'Choose a time in the future.';
    }
    if (kind === 'link' && !isHttps(link)) next.link = 'Enter a complete link starting with https://.';
    if (kind === 'video' && !isHttps(videoUrl)) next.videoUrl = 'Enter a complete video URL starting with https://.';
    if (kind === 'image') {
      if (!imageRef && !imageUrl.trim()) next.image = 'Choose an image, upload one, or remove the image attachment.';
      else if (!imageRef && !isHttps(imageUrl)) next.imageUrl = 'Enter a complete image URL starting with https://.';
      if (altText.length > rules.maxAlt) next.altText = `Keep the description to ${rules.maxAlt} characters or fewer.`;
    }
    if (formatError) next.attachment = formatError;
    return next;
  }
  const fieldIds: Record<string, string> = { message: `${ids}-message`, channels: `${ids}-channels`, scheduledLocal: `${ids}-when`, link: `${ids}-link`, videoUrl: `${ids}-video`, imageUrl: `${ids}-image-url`, image: `${ids}-pick`, altText: `${ids}-alt`, attachment: `${ids}-attachment` };

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    const found = validate();
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) {
      event.preventDefault();
      const target = document.getElementById(fieldIds[first]!);
      (target?.querySelector<HTMLElement>('input, textarea, button') ?? target)?.focus();
      return;
    }
    submitting.current = true;
  }

  const err = (key: string) => errors[key];
  const described = (key: string, extra?: string) => [err(key) ? `${fieldIds[key]}-error` : '', extra].filter(Boolean).join(' ') || undefined;
  const limitLines = selectedModules.length > 1 && new Set(selectedModules.map(module => module.traits.maxTextLength)).size > 1;
  const accept = rules.mimeTypes.join(',');

  return <>
    <form action={formAction} onSubmit={onSubmit} noValidate className={styles.layout} aria-label={initial ? 'Edit draft' : 'New post'}>
      <input type="hidden" name="postId" value={postId} />
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="attachmentKind" value={kind} />
      {[...selected].map(id => <input key={id} type="hidden" name="targetIds" value={id} />)}
      {intent === 'schedule' ? <input type="hidden" name="scheduledLocal" value={scheduledLocal} /> : null}

      <div className={styles.editor}>
        {state?.error ? <p className={`ui-notice ui-notice--danger`} role="alert">{state.saved ? 'Your changes were saved as a draft, but the next step failed. ' : ''}{state.error}</p> : null}
        {droppedChannels > 0 ? <p className="ui-notice ui-notice--warning" role="status">{droppedChannels === 1 ? 'One channel from this draft is' : `${droppedChannels} channels from this draft are`} no longer available and were left out of the selection.</p> : null}

        <section className={styles.section} aria-labelledby={`${ids}-h-channels`}>
          <h2 id={`${ids}-h-channels`}>Channels</h2>
          <p className="ui-hint">Choose where this post goes. Leave it empty to save a draft.</p>
          {channels.length ? <div id={fieldIds.channels} tabIndex={-1}><ChannelPicker channels={channels} modules={modules} selected={selected} maxTargets={rules.maxTargets} onChange={setSelected} error={err('channels')} /></div>
            : <EmptyState title="No channels can publish yet" action={canConnect ? <a className="ui-button ui-button--primary" href="/settings/connections">Connect a channel</a> : undefined}>
              Channels you connect appear here once they can publish. {canConnect ? 'You can still save this post as a draft.' : 'Ask a workspace admin to connect one. You can still save this post as a draft.'}
            </EmptyState>}
        </section>

        <section className={styles.section} aria-labelledby={`${ids}-h-content`}>
          <h2 id={`${ids}-h-content`}>Post</h2>
          <div className="ui-field">
            <label className="ui-label" htmlFor={fieldIds.message}>Post text</label>
            <textarea id={fieldIds.message} name="message" className={`ui-textarea ${styles.messageBox}`} value={message} rows={7} onChange={event => setMessage(event.target.value)} placeholder="What do you want to share?" aria-invalid={Boolean(err('message')) || count.over} aria-describedby={described('message', `${ids}-count`)} />
            {err('message') ? <p id={`${fieldIds.message}-error`} className="ui-field-error">{err('message')}</p> : null}
            <p id={`${ids}-count`} className={styles.counter} data-over={count.over || undefined}>
              <span>{count.over ? <span aria-hidden="true">▲ </span> : null}{count.length.toLocaleString()} / {limit.toLocaleString()} characters{count.over ? ` · ${(-count.remaining).toLocaleString()} over` : ''}</span>
              {limitLines ? <span className={styles.limitLines}>{selectedModules.map(module => `${module.name}: ${countStatus(message, Math.min(module.traits.maxTextLength, rules.maxText)).over ? 'over' : 'within'} its ${module.traits.maxTextLength.toLocaleString()}-character limit`).join(' · ')}</span> : selectedModules.length === 1 ? <span className={styles.limitLines}>{selectedModules[0]!.name} limit applies</span> : null}
            </p>
            <span className="ui-visually-hidden" role="status">{count.over ? `Over the limit by ${(-count.remaining).toLocaleString()} characters` : ''}</span>
          </div>
          {commentAllowed ? <div className="ui-field">
            <label className="ui-label" htmlFor={`${ids}-comment`}>First comment <span className={styles.optional}>(optional)</span></label>
            <textarea id={`${ids}-comment`} name="firstComment" className="ui-textarea" value={firstComment} rows={2} onChange={event => setFirstComment(event.target.value)} placeholder="Added as the first comment right after publishing" />
          </div> : <p className="ui-notice" role="status">{selectedModules.filter(module => !module.traits.firstComment).map(module => module.name).join(' and ')} cannot add a first comment.{firstComment.trim() ? ' Your first comment will not be sent.' : ''}</p>}
        </section>

        <section className={styles.section} aria-labelledby={`${ids}-h-attach`}>
          <h2 id={`${ids}-h-attach`}>Attachment</h2>
          <fieldset className={styles.choiceRow} id={fieldIds.attachment} tabIndex={-1}>
            <legend className="ui-label">One per post</legend>
            {kind === 'keep' ? <label className={styles.choice} data-checked><input type="radio" name="kindChoice" checked readOnly /><span>Keep {initial?.keptCount} existing attachments</span></label> : null}
            <label className={styles.choice} data-checked={kind === 'none' || undefined}><input type="radio" name="kindChoice" checked={kind === 'none'} onChange={() => setKind('none')} /><span>None</span></label>
            {formats.map(format => <label key={format} className={styles.choice} data-checked={kind === format || undefined}><input type="radio" name="kindChoice" checked={kind === format} onChange={() => setKind(format)} /><span>{FORMAT_LABEL[format]}</span></label>)}
            {currentFormat && !formats.includes(currentFormat) ? <label className={styles.choice} data-checked><input type="radio" name="kindChoice" checked readOnly /><span>{FORMAT_LABEL[currentFormat]} (not supported here)</span></label> : null}
          </fieldset>
          {err('attachment') || formatError ? <p id={`${fieldIds.attachment}-error`} className="ui-field-error" role="alert">{err('attachment') ?? formatError}</p> : null}

          {kind === 'keep' ? <p className="ui-hint">This draft has {initial?.keptCount} attachments added elsewhere. They stay as they are. Choose None or another type to replace them.</p> : null}

          {kind === 'link' ? <div className="ui-field">
            <label className="ui-label" htmlFor={fieldIds.link}>Link</label>
            <input id={fieldIds.link} name="link" type="url" inputMode="url" className="ui-input" value={link} onChange={event => setLink(event.target.value)} placeholder="https://example.com/article" aria-invalid={Boolean(err('link'))} aria-describedby={described('link')} />
            {err('link') ? <p id={`${fieldIds.link}-error`} className="ui-field-error">{err('link')}</p> : null}
          </div> : null}

          {kind === 'video' ? <div className="ui-field">
            <label className="ui-label" htmlFor={fieldIds.videoUrl}>Video URL</label>
            <input id={fieldIds.videoUrl} name="videoUrl" type="url" inputMode="url" className="ui-input" value={videoUrl} onChange={event => setVideoUrl(event.target.value)} placeholder="https://example.com/video.mp4" aria-invalid={Boolean(err('videoUrl'))} aria-describedby={described('videoUrl')} />
            <p className="ui-hint">A public link to the video file.</p>
            {err('videoUrl') ? <p id={`${fieldIds.videoUrl}-error`} className="ui-field-error">{err('videoUrl')}</p> : null}
          </div> : null}

          {kind === 'image' ? <div className={styles.imageBlock}>
            <input type="hidden" name="imageRef" value={imageRef} />
            {imageRef ? <div className={styles.thumbRow}>
              <img src={mediaUrl(imageRef)} alt="Selected image" width={96} height={96} />
              <div><p className="ui-hint">From your image library.</p><Button size="sm" onClick={() => { setImageRef(''); setAltText(''); }}>Remove image</Button></div>
            </div> : null}
            <div className={styles.buttonRow} id={fieldIds.image} tabIndex={-1}>
              {canBrowseLibrary ? <Button onClick={() => setPickerOpen(true)}>{imageRef ? 'Choose a different image' : 'Choose from library'}</Button> : null}
              {canUpload ? <label className={`ui-button ui-button--secondary${uploading ? ' is-busy' : ''}`}>
                <span>{uploading ? 'Uploading…' : 'Upload an image'}</span>
                <input className="ui-visually-hidden" type="file" accept={accept} disabled={uploading} onChange={(event: ChangeEvent<HTMLInputElement>) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void uploadFile(file); }} />
              </label> : null}
            </div>
            {canUpload || uploadError ? <p className="ui-hint" role="status">{uploadError ? <span className="ui-field-error">{uploadError}</span> : `Up to ${Math.floor(rules.maxUploadBytes / 1048576)} MB. Uploads are saved to your image library.`}</p> : null}
            {err('image') ? <p id={`${fieldIds.image}-error`} className="ui-field-error" role="alert">{err('image')}</p> : null}
            {!imageRef ? <div className="ui-field">
              <label className="ui-label" htmlFor={fieldIds.imageUrl}>{canUpload ? 'Or an image URL' : 'Image URL'} {canUpload ? <span className={styles.optional}>(optional)</span> : null}</label>
              <input id={fieldIds.imageUrl} name="imageUrl" type="url" inputMode="url" className="ui-input" value={imageUrl} onChange={event => setImageUrl(event.target.value)} placeholder="https://example.com/image.jpg" aria-invalid={Boolean(err('imageUrl'))} aria-describedby={described('imageUrl')} />
              {err('imageUrl') ? <p id={`${fieldIds.imageUrl}-error`} className="ui-field-error">{err('imageUrl')}</p> : null}
            </div> : null}
            <div className="ui-field">
              <label className="ui-label" htmlFor={fieldIds.altText}>Image description (alt text) <span className={styles.optional}>(recommended)</span></label>
              <input id={fieldIds.altText} name="altText" className="ui-input" value={altText} maxLength={rules.maxAlt + 50} onChange={event => setAltText(event.target.value)} placeholder="Describe the image for people who cannot see it" aria-invalid={Boolean(err('altText'))} aria-describedby={described('altText', `${ids}-alt-count`)} />
              <p id={`${ids}-alt-count`} className="ui-hint">{altText.length} / {rules.maxAlt}</p>
              {err('altText') ? <p id={`${fieldIds.altText}-error`} className="ui-field-error">{err('altText')}</p> : null}
            </div>
          </div> : null}
        </section>

        <section className={styles.section} aria-labelledby={`${ids}-h-when`}>
          <h2 id={`${ids}-h-when`}>When</h2>
          <fieldset className={styles.intentList}>
            <legend className="ui-visually-hidden">What should happen to this post</legend>
            {INTENTS.map(item => {
              const blocked = item.needsChannel && !hasChannels;
              return <label key={item.id} className={styles.intent} data-checked={intent === item.id || undefined} data-disabled={blocked || undefined}>
                <input type="radio" name="intentChoice" checked={intent === item.id} disabled={blocked} onChange={() => setIntent(item.id)} />
                <span><strong>{item.label}</strong><small>{blocked ? 'Choose a channel first.' : item.hint}</small></span>
              </label>;
            })}
          </fieldset>
          {intent === 'schedule' ? <div className="ui-field">
            <label className="ui-label" htmlFor={fieldIds.scheduledLocal}>Date and time</label>
            <input id={fieldIds.scheduledLocal} type="datetime-local" className="ui-input" value={scheduledLocal} min={nowLocal} step={60} onChange={event => setScheduledLocal(event.target.value)} aria-invalid={Boolean(err('scheduledLocal'))} aria-describedby={described('scheduledLocal', `${ids}-zone`)} />
            <p id={`${ids}-zone`} className="ui-hint">Workspace time zone: {timeZoneLabel}. It applies whatever device you use.</p>
            {err('scheduledLocal') ? <p id={`${fieldIds.scheduledLocal}-error`} className="ui-field-error">{err('scheduledLocal')}</p> : null}
          </div> : null}
        </section>

        <div className={styles.actions}>
          <button type="submit" className="ui-button ui-button--primary" disabled={pending || uploading} aria-busy={pending || undefined}>{pending ? 'Working…' : activeIntent.action}</button>
          <a className="ui-button ui-button--quiet" href="/publishing/posts">Cancel</a>
          {dirty ? <span className={styles.dirty} role="status">Unsaved changes</span> : null}
        </div>
      </div>

      <aside className={styles.side} aria-label="Preview">
        {selectedChannels.length > 1 ? <div className="ui-field">
          <label className="ui-label" htmlFor={`${ids}-preview-as`}>Preview as</label>
          <select id={`${ids}-preview-as`} className="ui-select" value={previewChannel?.id ?? ''} onChange={event => setPreviewId(event.target.value)}>
            {selectedChannels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
          </select>
        </div> : null}
        <PostPreview channel={previewChannel} message={message} firstComment={commentAllowed ? firstComment : ''} link={kind === 'link' ? link : ''} imageSrc={imageSrc} imageAlt={altText} videoUrl={kind === 'video' ? videoUrl : ''} when={when} />
      </aside>
    </form>

    {pickerOpen ? <MediaPickerDialog accept={accept} onClose={() => setPickerOpen(false)} onUploadFile={file => void uploadFile(file)} onPick={image => { setImageRef(`media:${image.id}`); setImageUrl(''); setPickerOpen(false); }} /> : null}

    {leaveHref ? <ModalDialog className="ui-dialog" labelledBy={`${ids}-leave-title`} describedBy={`${ids}-leave-text`} onDismiss={() => setLeaveHref(null)}>
      <div className="ui-dialog__header"><div><h2 id={`${ids}-leave-title`}>Leave without saving?</h2><p id={`${ids}-leave-text`}>You have changes that are not saved. If you leave now, they are lost.</p></div></div>
      <div className="ui-dialog__actions">
        <Button data-dialog-cancel onClick={() => setLeaveHref(null)}>Keep editing</Button>
        <Button variant="danger" onClick={() => { leaving.current = true; window.location.assign(leaveHref); }}>Leave and discard</Button>
      </div>
    </ModalDialog> : null}
  </>;
}
