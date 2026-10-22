'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { IconAlertTriangle, IconCheck, IconDownload, IconLink, IconMicrophone, IconPhoto, IconSparkles, IconTrendingUp, IconVideo } from '@tabler/icons-react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { SegmentedControl } from '@/components/Forms';
import { PageHeader } from '@/components/PageHeader';
import { Tabs } from '@/components/Tabs';
import { useConfirm } from '@/components/useConfirm';
import { fill, type ToolsCopy } from '../copy';
import type { MediaStatus } from '../server/media';
import styles from './ai-studio.module.css';

type Video = { id: string; prompt: string; aspectRatio: string; status: 'working' | 'ready' | 'failed'; mediaId: string | null; error: string | null; createdAt: string };
type Channel = { id: string; name: string };
type Preview = { url: string; title: string | null; description: string | null; imageUrl: string | null; siteName: string | null };
type Outlook = { outlook: 'above' | 'around' | 'below' | 'unknown'; basis: number; reasons: Array<{ factor: 'format' | 'length' | 'time' | 'weekday'; value: string; ratio: number; posts: number }>; channel: string | null };
type Spam = { risk: { pages: number; network: string; ownPages: number; otherPosts: number; gapMinutes: number } | null; gapMinutes: number };
const FORMATS = ['photo', 'video', 'link', 'text', 'other'] as const;
const VIDEO_POLL_MS = 15_000;

async function call<T>(url: string, body: unknown, fallback: string): Promise<{ data?: T; response?: Response; error?: string }> {
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) { const failure = await response.json().catch(() => null) as { error?: string } | null; return { error: failure?.error || fallback }; }
    return { response, data: response.headers.get('content-type')?.includes('json') ? await response.clone().json() as T : undefined };
  } catch { return { error: fallback }; }
}

/** Pictures, video and voice from a description, plus the advice a post gets before it is scheduled. */
export function AiStudioScreen({ status, videos: initialVideos, channels, canCheck, copy: t, locale }: { status: MediaStatus; videos: Video[]; channels: Channel[]; canCheck: boolean; copy: ToolsCopy; locale: 'en' | 'fr' }) {
  const [pending, start] = useTransition();
  const [ask, dialog] = useConfirm({ title: t.confirm, cancel: t.cancel, confirm: t.confirm, danger: false });
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const live = useRef<HTMLParagraphElement>(null);
  const number = new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-GB');
  const label = (names: { en: string; fr: string }) => names[locale];

  // picture
  const [imagePrompt, setImagePrompt] = useState(''); const [size, setSize] = useState(status.image.defaultSize ?? ''); const [image, setImage] = useState<{ id: string } | null>(null);
  // video
  const [videoPrompt, setVideoPrompt] = useState(''); const [aspect, setAspect] = useState(status.video.defaultAspectRatio ?? ''); const [videos, setVideos] = useState(initialVideos);
  // voice
  const [voiceText, setVoiceText] = useState(''); const [voice, setVoice] = useState(status.voice.defaultVoice ?? ''); const [audio, setAudio] = useState<string | null>(null);
  // check
  const [selected, setSelected] = useState<string[]>([]); const [text, setText] = useState(''); const [link, setLink] = useState(''); const [format, setFormat] = useState<(typeof FORMATS)[number]>('text'); const [when, setWhen] = useState('');
  const [outlooks, setOutlooks] = useState<Outlook[] | null>(null); const [spam, setSpam] = useState<Spam | null>(null); const [preview, setPreview] = useState<Preview | null | undefined>(undefined);

  useEffect(() => () => { if (audio) URL.revokeObjectURL(audio); }, [audio]);
  const working = videos.some(video => video.status === 'working');
  useEffect(() => {
    if (!working) return undefined;
    const timer = setInterval(async () => {
      try { const response = await fetch('/api/ai/video'); if (response.ok) setVideos(((await response.json()) as { videos: Video[] }).videos); } catch { /* the next check retries */ }
    }, VIDEO_POLL_MS);
    return () => clearInterval(timer);
  }, [working]);

  /** Ask first, outside the transition: an update made inside a pending async action is not shown until the action ends. */
  async function generate(question: string, task: () => Promise<string | null>) {
    setError(''); setNotice('');
    if (pending || !await ask(question)) return;
    start(async () => {
      const failure = await task();
      if (failure) setError(failure);
      live.current?.focus();
    });
  }
  const makeImage = () => generate(t.imageConfirm, async () => {
    const result = await call<{ id: string }>('/api/ai/image', { prompt: imagePrompt, size, confirmation: status.confirmations.image }, t.errUpstream);
    if (result.error || !result.data) return result.error ?? t.errUpstream;
    setImage({ id: result.data.id }); setNotice(t.imageDone); return null;
  });
  const makeVideo = () => generate(t.videoConfirm, async () => {
    const result = await call('/api/ai/video', { prompt: videoPrompt, aspectRatio: aspect, confirmation: status.confirmations.video }, t.errUpstream);
    if (result.error) return result.error;
    try { const response = await fetch('/api/ai/video'); if (response.ok) setVideos(((await response.json()) as { videos: Video[] }).videos); } catch { /* shown on the next check */ }
    setNotice(t.videoStarted); setVideoPrompt(''); return null;
  });
  const makeVoice = () => generate(t.voiceConfirm, async () => {
    const result = await call('/api/ai/voice', { text: voiceText, voice, confirmation: status.confirmations.voice }, t.errUpstream);
    if (result.error || !result.response) return result.error ?? t.errUpstream;
    setAudio(URL.createObjectURL(await result.response.blob())); setNotice(t.voiceDone); return null;
  });
  function check() {
    start(async () => {
      setError(''); setNotice('');
      if (!selected.length) { setError(t.chooseChannel); return; }
      const scheduledAtLocal = when || undefined;
      const [spamResult, previewResult, ...outlookResults] = await Promise.all([
        call<Spam>('/api/publishing/spam-check', { message: text, link: link || null, targetIds: selected, scheduledAtLocal }, t.errUpstream),
        link.trim() ? call<{ preview: Preview | null }>('/api/publishing/link-preview', { url: link.trim() }, t.errLink) : Promise.resolve(null),
        ...selected.slice(0, 5).map(targetId => call<Outlook>('/api/publishing/outlook', { targetId, format, length: text.length, scheduledAtLocal }, t.errUpstream)),
      ]);
      const firstError = [spamResult, previewResult, ...outlookResults].find(result => result?.error)?.error;
      if (firstError) setError(firstError);
      setSpam(spamResult.data ?? null); setPreview(previewResult ? previewResult.data?.preview ?? null : undefined);
      setOutlooks(outlookResults.flatMap(result => result.data ? [result.data] : []));
      live.current?.focus();
    });
  }

  const unavailable = <EmptyState icon={<IconSparkles size={22} />} title={t.notAvailable} />;
  const factor = { format: t.factorFormat, length: t.factorLength, time: t.factorTime, weekday: t.factorWeekday };
  const valueName = (reason: Outlook['reasons'][number]) => {
    const names: Record<string, string> = { short: t.lengthShort, medium: t.lengthMedium, long: t.lengthLong, night: t.hourNight, morning: t.hourMorning, afternoon: t.hourAfternoon, evening: t.hourEvening, photo: t.formatPhoto, video: t.formatVideo, link: t.formatLink, text: t.formatText, other: t.formatOther };
    return reason.factor === 'weekday' ? (t as Record<string, string>)[`day${reason.value}`] ?? reason.value : names[reason.value] ?? reason.value;
  };
  const verdict = { above: { text: t.outlookAbove, tone: 'success' as const }, around: { text: t.outlookAround, tone: 'neutral' as const }, below: { text: t.outlookBelow, tone: 'warning' as const }, unknown: { text: t.outlookUnknown, tone: 'neutral' as const } };
  const usage = status.usage;
  const budgetNote = usage?.budgetUsd ? usage.remainingUsd === 0 ? t.budgetUsed : fill(t.budgetLeft, { amount: `$${number.format(Math.round((usage.remainingUsd ?? 0) * 100) / 100)}` }) : null;

  const imageTab = !status.image.available ? unavailable : <form className={styles.panel} onSubmit={event => { event.preventDefault(); makeImage(); }}>
    <h2><IconPhoto size={20} aria-hidden="true" /> {t.imageHeading}</h2>
    <label className="ui-field"><span>{t.imagePrompt}</span><textarea className="ui-input" rows={4} required value={imagePrompt} maxLength={status.image.promptMaxCharacters ?? undefined} disabled={pending} onChange={event => setImagePrompt(event.target.value)} /></label>
    <SegmentedControl legend={t.imageSize} value={size} onChange={setSize} options={status.image.sizes.map(option => ({ value: option.id, label: label(option.label) }))} />
    <div className={styles.actions}><Button type="submit" variant="primary" busy={pending} disabled={!imagePrompt.trim()} leading={<IconSparkles size={16} />}>{pending ? t.busy : t.imageRun}</Button></div>
    {image ? <figure className={styles.result}><img src={`/api/media/${encodeURIComponent(image.id)}`} alt={t.imageAlt} /><figcaption>{t.imageDone} <a href="/content/library">{t.imageOpenLibrary}</a></figcaption></figure> : null}
  </form>;

  const videoTab = !status.video.available ? unavailable : <div className={styles.stack}>
    <form className={styles.panel} onSubmit={event => { event.preventDefault(); makeVideo(); }}>
      <h2><IconVideo size={20} aria-hidden="true" /> {t.videoHeading}</h2>
      <label className="ui-field"><span>{t.videoPrompt}</span><textarea className="ui-input" rows={4} required value={videoPrompt} maxLength={status.video.promptMaxCharacters ?? undefined} disabled={pending} onChange={event => setVideoPrompt(event.target.value)} /></label>
      <SegmentedControl legend={t.videoAspect} value={aspect} onChange={setAspect} options={status.video.aspectRatios.map(option => ({ value: option.id, label: label(option.label) }))} />
      <div className={styles.actions}><Button type="submit" variant="primary" busy={pending} disabled={!videoPrompt.trim()} leading={<IconVideo size={16} />}>{pending ? t.busy : t.videoRun}</Button></div>
    </form>
    <section className={styles.panel} aria-live="polite"><h2>{t.videoRecent}</h2>
      {videos.length === 0 ? <p className={styles.hint}>{t.videoNone}</p> : <ul className={styles.videos}>{videos.map(video => <li key={video.id}>
        <span className={styles.videoText}>{video.prompt}</span>
        {video.status === 'working' ? <Badge tone="brand">{t.videoWorking}</Badge> : video.status === 'ready' ? <Badge tone="success" icon={<IconCheck size={14} />}>{t.videoReady}</Badge> : <Badge tone="danger" icon={<IconAlertTriangle size={14} />}>{t.videoFailed}</Badge>}
      </li>)}</ul>}
    </section>
  </div>;

  const voiceTab = !status.voice.available ? unavailable : <form className={styles.panel} onSubmit={event => { event.preventDefault(); makeVoice(); }}>
    <h2><IconMicrophone size={20} aria-hidden="true" /> {t.voiceHeading}</h2>
    <label className="ui-field"><span>{t.voiceText}</span><textarea className="ui-input" rows={5} required value={voiceText} maxLength={status.voice.textMaxCharacters ?? undefined} disabled={pending} onChange={event => setVoiceText(event.target.value)} /></label>
    <label className="ui-field"><span>{t.voiceVoice}</span><select className="ui-input" value={voice} disabled={pending} onChange={event => setVoice(event.target.value)}>{status.voice.voices.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
    <div className={styles.actions}><Button type="submit" variant="primary" busy={pending} disabled={!voiceText.trim()} leading={<IconMicrophone size={16} />}>{pending ? t.busy : t.voiceRun}</Button></div>
    {audio ? <div className={styles.result}><audio controls src={audio} /><a className="ui-button ui-button--secondary ui-button--md" href={audio} download="ai-voice.mp3"><IconDownload size={16} aria-hidden="true" /> {t.voiceDownload}</a></div> : null}
  </form>;

  const checkTab = !canCheck ? unavailable : channels.length === 0 ? <EmptyState icon={<IconTrendingUp size={22} />} title={t.noChannels} /> : <div className={styles.stack}>
    <form className={styles.panel} onSubmit={event => { event.preventDefault(); check(); }}>
      <h2><IconTrendingUp size={20} aria-hidden="true" /> {t.checkHeading}</h2>
      <p className={styles.hint}>{t.checkIntro}</p>
      <fieldset className={styles.channels}><legend>{t.checkChannels}</legend>{channels.map(channel => <label key={channel.id} className={styles.channel}><input type="checkbox" checked={selected.includes(channel.id)} disabled={pending} onChange={event => setSelected(list => event.target.checked ? [...list, channel.id] : list.filter(id => id !== channel.id))} /> {channel.name}</label>)}</fieldset>
      <label className="ui-field"><span>{t.checkText}</span><textarea className="ui-input" rows={4} value={text} disabled={pending} onChange={event => setText(event.target.value)} /></label>
      <div className={styles.fields}>
        <label className="ui-field"><span>{t.checkLink}</span><input className="ui-input" type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://" value={link} disabled={pending} onChange={event => setLink(event.target.value)} /></label>
        <label className="ui-field"><span>{t.checkFormat}</span><select className="ui-input" value={format} disabled={pending} onChange={event => setFormat(event.target.value as (typeof FORMATS)[number])}>{FORMATS.map(name => <option key={name} value={name}>{({ photo: t.formatPhoto, video: t.formatVideo, link: t.formatLink, text: t.formatText, other: t.formatOther })[name]}</option>)}</select></label>
        <label className="ui-field"><span>{t.checkTime}</span><input className="ui-input" type="datetime-local" value={when} disabled={pending} onChange={event => setWhen(event.target.value)} /></label>
      </div>
      <div className={styles.actions}><Button type="submit" variant="primary" busy={pending} leading={<IconTrendingUp size={16} />}>{pending ? t.busy : t.checkRun}</Button></div>
    </form>
    {outlooks || spam || preview !== undefined ? <div className={styles.results} aria-live="polite">
      {outlooks?.map(item => <section key={item.channel} className={styles.panel}>
        <h3>{t.outlookHeading}{item.channel ? ` · ${item.channel}` : ''}</h3>
        <Badge tone={verdict[item.outlook].tone}>{verdict[item.outlook].text}</Badge>
        {item.outlook !== 'unknown' ? <p className={styles.hint}>{fill(t.outlookBasis, { count: number.format(item.basis), channel: item.channel ?? '' })}</p> : null}
        {item.reasons.length ? <ul className={styles.reasons}>{item.reasons.map(reason => <li key={reason.factor}>{fill(t.reasonLine, { factor: factor[reason.factor], value: valueName(reason), ratio: number.format(reason.ratio), posts: number.format(reason.posts) })}</li>)}</ul> : null}
      </section>)}
      {spam ? <section className={styles.panel}><h3>{t.spamHeading}</h3>
        {spam.gapMinutes <= 0 ? <p>{t.spamOff}</p> : spam.risk ? <p className={styles.warn}><IconAlertTriangle size={18} aria-hidden="true" /> {fill(t.spamRisk, { pages: spam.risk.pages, network: spam.risk.network, gap: spam.risk.gapMinutes, own: spam.risk.ownPages, others: spam.risk.otherPosts })}</p> : <p className={styles.good}><IconCheck size={18} aria-hidden="true" /> {t.spamNone}</p>}
      </section> : null}
      {preview !== undefined ? <section className={styles.panel}><h3><IconLink size={18} aria-hidden="true" /> {t.previewHeading}</h3>
        {preview ? <div className={styles.preview}>{preview.imageUrl ? <img src={preview.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}<div><strong>{preview.title}</strong>{preview.description ? <p>{preview.description}</p> : null}{preview.siteName ? <small>{fill(t.previewFrom, { site: preview.siteName })}</small> : null}</div></div> : <p className={styles.hint}>{t.previewNone}</p>}
      </section> : null}
    </div> : null}
  </div>;

  return <section className={styles.root} data-module="publishing" aria-busy={pending}>
    <PageHeader module="publishing" title={t.title} description={t.intro} />
    {budgetNote ? <p className={styles.budget}>{budgetNote}</p> : null}
    <p ref={live} tabIndex={-1} role="status" className={notice ? styles.noticeOn : styles.noticeOff}>{notice}</p>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    <Tabs label={t.title} items={[
      { id: 'image', label: t.tabImage, icon: <IconPhoto size={16} />, content: imageTab },
      { id: 'video', label: t.tabVideo, icon: <IconVideo size={16} />, count: videos.filter(video => video.status === 'working').length || undefined, content: videoTab },
      { id: 'voice', label: t.tabVoice, icon: <IconMicrophone size={16} />, content: voiceTab },
      { id: 'check', label: t.tabCheck, icon: <IconTrendingUp size={16} />, content: checkTab },
    ]} />
    {dialog}
  </section>;
}
