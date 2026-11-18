'use client';
import { useEffect, useState } from 'react';
import { IconSparkles } from '@tabler/icons-react';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { useConfirm } from '@/components/useConfirm';
import { ChannelSelect } from '@/modules/publishing/ui/compose/ChannelSelect';
import { AI_REPLY_DELAYS, AI_REPLY_TONES, type AiRepliesSettings } from '../ai-replies';
import styles from './ModerationRules.module.css';

type View = AiRepliesSettings & { enabledAt: string | null; channels: Array<{ id: string; name: string }>; week: { replied: number; handedOff: number; skipped: number; failed: number } };
type Locale = 'en' | 'fr';
type PreviewItem = { kind: 'comment' | 'message'; channel: string; author: string | null; text: string; decision: 'reply' | 'handoff' | 'skip'; reply: string | null; reason: string; by: 'rule' | 'ai' };

export const aiRepliesCopy = {
  en: {
    title: 'AI auto-replies', on: 'On', off: 'Off', intro: 'The AI answers comments and Messenger messages that nobody on the team has answered after the wait you choose. Complaints, angry or sensitive messages and spam are left for a person, and owners and admins are notified.',
    enable: 'Answer automatically with AI', answer: 'Answer', comments: 'Comments under your posts', messages: 'Messenger messages (within Meta’s 24-hour window)', wait: 'Answer after', minutes: '{n} min without a reply', hour: '{n} h without a reply',
    tone: 'Tone', tone_friendly: 'Warm and friendly', tone_short: 'Short and kind', tone_expert: 'Helpful, like a cook', channels: 'Channels', allChannels: 'All channels', chooseChannels: 'Only these channels',
    week: 'Last 7 days: {replied} sent · {handedOff} left for a person · {skipped} not answered (spam) · {failed} failed', since: 'Answering what arrives after {when}. Each reply is in the log below, with what was sent.',
    loopNote: 'In one Messenger conversation, after three AI replies in a day a person takes over.', save: 'Save', saved: 'Saved.', saveFailed: 'The settings could not be saved.', loadFailed: 'AI auto-replies could not be loaded.',
    preview: 'Try on recent messages', previewing: 'Asking the AI…', previewTitle: 'What the AI would answer', previewNote: 'The latest unanswered comments and messages of the last 24 hours, with the settings above (saved or not). Nothing is sent.',
    previewEmpty: 'No unanswered comment or message in the last 24 hours.', previewUnavailable: 'The AI is unavailable or over its hourly limit; try again later.', previewFailed: 'The preview could not be made.',
    d_reply: 'Would reply', d_handoff: 'Left for a person', d_skip: 'No reply', why_spam: 'link or phone number (spam)', why_negative: 'negative comment', why_unusable: 'the AI’s answer was not usable', kind_comment: 'Comment', kind_message: 'Message',
    confirmTitle: 'Let the AI answer for your Pages?', confirmText: 'From now on, the AI replies on your Pages to comments and messages nobody answered, without anyone pressing Send. You can switch it off at any time.', confirm: 'Switch on', cancel: 'Cancel', pickBoth: 'Choose comments, messages or both.',
  },
  fr: {
    title: 'Réponses automatiques par IA', on: 'Activé', off: 'Désactivé', intro: 'L’IA répond aux commentaires et aux messages Messenger restés sans réponse de l’équipe après le délai choisi. Les plaintes, les messages énervés ou sensibles et le spam sont laissés à une personne ; les propriétaires et administrateurs sont prévenus.',
    enable: 'Répondre automatiquement avec l’IA', answer: 'Répondre à', comments: 'Commentaires sous vos publications', messages: 'Messages Messenger (dans la fenêtre de 24 h de Meta)', wait: 'Répondre après', minutes: '{n} min sans réponse', hour: '{n} h sans réponse',
    tone: 'Ton', tone_friendly: 'Chaleureux', tone_short: 'Court et aimable', tone_expert: 'Précis, comme un cuisinier', channels: 'Canaux', allChannels: 'Tous les canaux', chooseChannels: 'Seulement ces canaux',
    week: '7 derniers jours : {replied} envoyées · {handedOff} laissées à une personne · {skipped} sans réponse (spam) · {failed} en échec', since: 'Répond à ce qui arrive après le {when}. Chaque réponse figure dans le journal ci-dessous, avec le texte envoyé.',
    loopNote: 'Dans une même conversation Messenger, après trois réponses de l’IA dans la journée, une personne prend le relais.', save: 'Enregistrer', saved: 'Enregistré.', saveFailed: 'Les réglages n’ont pas pu être enregistrés.', loadFailed: 'Les réponses automatiques n’ont pas pu être chargées.',
    preview: 'Essayer sur des messages récents', previewing: 'L’IA réfléchit…', previewTitle: 'Ce que l’IA répondrait', previewNote: 'Les derniers commentaires et messages sans réponse des dernières 24 h, avec les réglages ci-dessus (enregistrés ou non). Rien n’est envoyé.',
    previewEmpty: 'Aucun commentaire ni message sans réponse ces dernières 24 h.', previewUnavailable: 'L’IA est indisponible ou a atteint sa limite horaire ; réessayez plus tard.', previewFailed: 'L’essai n’a pas pu être fait.',
    d_reply: 'Répondrait', d_handoff: 'Laissé à une personne', d_skip: 'Pas de réponse', why_spam: 'lien ou numéro de téléphone (spam)', why_negative: 'commentaire négatif', why_unusable: 'la réponse de l’IA n’était pas exploitable', kind_comment: 'Commentaire', kind_message: 'Message',
    confirmTitle: 'Laisser l’IA répondre pour vos Pages ?', confirmText: 'Dès maintenant, l’IA répond sur vos Pages aux commentaires et messages restés sans réponse, sans que personne n’appuie sur Envoyer. Vous pouvez la désactiver à tout moment.', confirm: 'Activer', cancel: 'Annuler', pickBoth: 'Choisissez les commentaires, les messages ou les deux.',
  },
} as const;
const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (whole, name: string) => name in values ? String(values[name]) : whole);

/** Inbox › Rules: AI auto-replies (2026-11-17). Saved settings apply from the next Inbox sync. */
export function AiRepliesPanel({ locale, canWrite }: { locale: Locale; canWrite: boolean }) {
  const t = aiRepliesCopy[locale];
  const [view, setView] = useState<View | null>(null);
  const [draft, setDraft] = useState<AiRepliesSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<{ items: PreviewItem[]; aiUnavailable: boolean } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [ask, dialog] = useConfirm({ title: t.confirmTitle, cancel: t.cancel, confirm: t.confirm });
  const take = (next: View) => { setView(next); setDraft({ enabled: next.enabled, comments: next.comments, messages: next.messages, delayMinutes: next.delayMinutes, targetIds: next.targetIds, tone: next.tone }); };
  useEffect(() => {
    let live = true;
    void fetch('/api/inbox/ai-replies').then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? t.loadFailed); if (live) take(body as View); })
      .catch(error => { if (live) setMessage({ error: true, text: error instanceof Error ? error.message : t.loadFailed }); });
    return () => { live = false; };
  }, [t.loadFailed]);

  async function save() {
    if (!draft || !view) return;
    if (draft.enabled && !draft.comments && !draft.messages) { setMessage({ error: true, text: t.pickBoth }); return; }
    if (draft.enabled && !view.enabled && !(await ask(t.confirmText))) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch('/api/inbox/ai-replies', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? t.saveFailed);
      take(body as View); setMessage({ error: false, text: t.saved });
    } catch (error) { setMessage({ error: true, text: error instanceof Error ? error.message : t.saveFailed }); }
    finally { setBusy(false); }
  }

  async function tryIt() {
    if (!draft) return;
    setPreviewing(true); setMessage(null);
    try {
      const response = await fetch('/api/inbox/ai-replies/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...draft, enabled: false }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? t.previewFailed);
      setPreview(body);
    } catch (error) { setMessage({ error: true, text: error instanceof Error ? error.message : t.previewFailed }); }
    finally { setPreviewing(false); }
  }
  const why = (item: PreviewItem) => item.by === 'rule' || item.reason === 'unusable' ? t[`why_${item.reason}` as 'why_spam'] ?? item.reason : item.reason;

  const when = view?.enabledAt ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(view.enabledAt)) : null;
  const delayLabel = (n: number) => n >= 60 ? fill(t.hour, { n: n / 60 }) : fill(t.minutes, { n });
  const off = !draft?.enabled || !canWrite || busy;
  return <section className={styles.panel} aria-labelledby="ai-replies-heading">
    <div className={styles.head}><span className={styles.row}><IconSparkles size={20} aria-hidden="true" /><h2 id="ai-replies-heading">{t.title}</h2>
      {view ? <Badge tone={view.enabled ? 'success' : 'neutral'}>{view.enabled ? t.on : t.off}</Badge> : null}</span></div>
    <p className={styles.hint}>{t.intro}</p>
    {view && draft ? <form className={styles.form} aria-label={t.title} onSubmit={event => { event.preventDefault(); void save(); }}>
      <label className={styles.check}><input type="checkbox" disabled={!canWrite || busy} checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />{t.enable}</label>
      <fieldset className={styles.channels} disabled={off}><legend>{t.answer}</legend>
        <label className={styles.check}><input type="checkbox" checked={draft.comments} onChange={e => setDraft({ ...draft, comments: e.target.checked })} />{t.comments}</label>
        <label className={styles.check}><input type="checkbox" checked={draft.messages} onChange={e => setDraft({ ...draft, messages: e.target.checked })} />{t.messages}</label>
      </fieldset>
      <label>{t.wait}<select disabled={off} value={draft.delayMinutes} onChange={e => setDraft({ ...draft, delayMinutes: Number(e.target.value) })}>{AI_REPLY_DELAYS.map(n => <option key={n} value={n}>{delayLabel(n)}</option>)}</select></label>
      <label>{t.tone}<select disabled={off} value={draft.tone} onChange={e => setDraft({ ...draft, tone: e.target.value as AiRepliesSettings['tone'] })}>{AI_REPLY_TONES.map(tone => <option key={tone} value={tone}>{t[`tone_${tone}`]}</option>)}</select></label>
      <fieldset className={styles.channels} disabled={off}><legend>{t.channels}</legend>
        <label className={styles.check}><input type="radio" name="ai-scope" checked={draft.targetIds.length === 0} onChange={() => setDraft({ ...draft, targetIds: [] })} />{t.allChannels}</label>
        <label className={styles.check}><input type="radio" name="ai-scope" checked={draft.targetIds.length > 0} onChange={() => setDraft({ ...draft, targetIds: view.channels.slice(0, 1).map(channel => channel.id) })} />{t.chooseChannels}</label>
        {draft.targetIds.length > 0 ? <ChannelSelect channels={view.channels} selected={draft.targetIds} locale={locale} disabled={off}
          onToggle={id => setDraft({ ...draft, targetIds: draft.targetIds.includes(id) ? draft.targetIds.filter(item => item !== id) : [...draft.targetIds, id] })}
          onSetAll={ids => setDraft({ ...draft, targetIds: ids })} /> : null}
      </fieldset>
      <div className={styles.hint}>
        {view.enabled && when ? <>{fill(t.since, { when })}<br /></> : null}
        {fill(t.week, view.week)}<br />
        {t.loopNote}
      </div>
      {canWrite ? <div className={styles.row}><Button type="submit" variant="primary" disabled={busy || previewing}>{t.save}</Button>
        <Button type="button" variant="secondary" disabled={busy || previewing || (!draft.comments && !draft.messages)} onClick={() => void tryIt()}>{previewing ? t.previewing : t.preview}</Button></div> : null}
      {preview ? <div className={styles.preview} aria-live="polite"><h3>{t.previewTitle}</h3><p className={styles.hint}>{t.previewNote}</p>
        {preview.items.length ? <ul className={styles.list}>{preview.items.map((item, index) => <li key={index} className={styles.item}>
          <span className={styles.meta}>{t[`kind_${item.kind}`]} · {item.channel}</span>
          <span><strong>{item.author || '—'}</strong> : {item.text}</span>
          <span className={styles.row}><Badge tone={item.decision === 'reply' ? 'success' : item.decision === 'handoff' ? 'warning' : 'neutral'}>{t[`d_${item.decision}`]}</Badge>{item.decision !== 'reply' && why(item) ? <span className={styles.hint}>{why(item)}</span> : null}</span>
          {item.reply ? <span className={styles.reply}>{item.reply}</span> : null}
        </li>)}</ul> : !preview.aiUnavailable ? <p className={styles.hint}>{t.previewEmpty}</p> : null}
        {preview.aiUnavailable ? <p className={styles.error} role="alert">{t.previewUnavailable}</p> : null}
      </div> : null}
    </form> : null}
    {message ? <p className={message.error ? styles.error : styles.success} role={message.error ? 'alert' : 'status'}>{message.text}</p> : null}
    {dialog}
  </section>;
}
