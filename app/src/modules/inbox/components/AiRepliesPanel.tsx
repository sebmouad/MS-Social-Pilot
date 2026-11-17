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

export const aiRepliesCopy = {
  en: {
    title: 'AI auto-replies', on: 'On', off: 'Off', intro: 'The AI answers comments and Messenger messages that nobody on the team has answered after the wait you choose. Complaints, angry or sensitive messages and spam are left for a person, and owners and admins are notified.',
    enable: 'Answer automatically with AI', answer: 'Answer', comments: 'Comments under your posts', messages: 'Messenger messages (within Meta’s 24-hour window)', wait: 'Answer after', minutes: '{n} min without a reply', hour: '{n} h without a reply',
    tone: 'Tone', tone_friendly: 'Warm and friendly', tone_short: 'Short and kind', tone_expert: 'Helpful, like a cook', channels: 'Channels', allChannels: 'All channels', chooseChannels: 'Only these channels',
    week: 'Last 7 days: {replied} sent · {handedOff} left for a person · {skipped} not answered (spam) · {failed} failed', since: 'Answering what arrives after {when}. Each reply is in the log below, with what was sent.',
    loopNote: 'In one Messenger conversation, after three AI replies in a day a person takes over.', save: 'Save', saved: 'Saved.', saveFailed: 'The settings could not be saved.', loadFailed: 'AI auto-replies could not be loaded.',
    confirmTitle: 'Let the AI answer for your Pages?', confirmText: 'From now on, the AI replies on your Pages to comments and messages nobody answered, without anyone pressing Send. You can switch it off at any time.', confirm: 'Switch on', cancel: 'Cancel', pickBoth: 'Choose comments, messages or both.',
  },
  fr: {
    title: 'Réponses automatiques par IA', on: 'Activé', off: 'Désactivé', intro: 'L’IA répond aux commentaires et aux messages Messenger restés sans réponse de l’équipe après le délai choisi. Les plaintes, les messages énervés ou sensibles et le spam sont laissés à une personne ; les propriétaires et administrateurs sont prévenus.',
    enable: 'Répondre automatiquement avec l’IA', answer: 'Répondre à', comments: 'Commentaires sous vos publications', messages: 'Messages Messenger (dans la fenêtre de 24 h de Meta)', wait: 'Répondre après', minutes: '{n} min sans réponse', hour: '{n} h sans réponse',
    tone: 'Ton', tone_friendly: 'Chaleureux', tone_short: 'Court et aimable', tone_expert: 'Précis, comme un cuisinier', channels: 'Canaux', allChannels: 'Tous les canaux', chooseChannels: 'Seulement ces canaux',
    week: '7 derniers jours : {replied} envoyées · {handedOff} laissées à une personne · {skipped} sans réponse (spam) · {failed} en échec', since: 'Répond à ce qui arrive après le {when}. Chaque réponse figure dans le journal ci-dessous, avec le texte envoyé.',
    loopNote: 'Dans une même conversation Messenger, après trois réponses de l’IA dans la journée, une personne prend le relais.', save: 'Enregistrer', saved: 'Enregistré.', saveFailed: 'Les réglages n’ont pas pu être enregistrés.', loadFailed: 'Les réponses automatiques n’ont pas pu être chargées.',
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
      {canWrite ? <div className={styles.row}><Button type="submit" variant="primary" disabled={busy}>{t.save}</Button></div> : null}
    </form> : null}
    {message ? <p className={message.error ? styles.error : styles.success} role={message.error ? 'alert' : 'status'}>{message.text}</p> : null}
    {dialog}
  </section>;
}
