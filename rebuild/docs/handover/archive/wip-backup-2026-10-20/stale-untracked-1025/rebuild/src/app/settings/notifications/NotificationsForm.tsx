'use client';

import { useState } from 'react';
import ui from '@/modules/integrations/ui/integrations.module.css';
import type { NotificationView } from '@/modules/integrations/server/notifications';

const FLAGS: Array<{ key: keyof NotificationView['preferences']; label: string; hint: string }> = [
  { key: 'onPublishFailure', label: 'A post could not be published', hint: 'Sent right away so you can fix it.' },
  { key: 'onTokenExpiry', label: 'A channel connection needs attention', hint: 'Before or when a connection stops working.' },
  { key: 'onApprovalRequest', label: 'A post is waiting for your approval', hint: '' },
  { key: 'onApprovalDecision', label: 'Your post was approved or sent back', hint: '' },
  { key: 'onNewInbox', label: 'New comments and messages (hourly summary)', hint: 'Off until you turn it on.' },
  { key: 'onQueueEmpty', label: 'A channel has nothing left scheduled', hint: '' },
  { key: 'onDraftUpdated', label: 'Someone changed a post you wrote', hint: 'Only while it is not published yet.' },
  { key: 'onModerationAlert', label: 'A comment matched a moderation rule', hint: '' },
  { key: 'onNoteMention', label: 'A teammate mentioned you in a note', hint: '' },
];
const EVENTS = [['publishFailure', 'Failures'], ['newInbox', 'Inbox'], ['queueEmpty', 'Empty queue']] as const;

export function NotificationsForm({ initial }: { initial: NotificationView }) {
  const [prefs, setPrefs] = useState(initial.preferences);
  const [mutes, setMutes] = useState(new Set(initial.mutes.map(m => `${m.targetId}|${m.event}`)));
  const [state, setState] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; message: string }>({ kind: 'idle', message: '' });
  const [dirty, setDirty] = useState(false);
  const tooMany = mutes.size > initial.maxMutes;
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (tooMany) { setState({ kind: 'error', message: `You can mute at most ${initial.maxMutes} combinations.` }); return; }
    setState({ kind: 'saving', message: 'Saving...' });
    try {
      const response = await fetch('/api/notifications', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...prefs, mutes: [...mutes].map(key => { const [targetId, ev] = key.split('|'); return { targetId, event: ev }; }), confirmation: 'UPDATE NOTIFICATION PREFERENCES' }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Your settings could not be saved.');
      setState({ kind: 'saved', message: 'Notification settings saved.' }); setDirty(false);
    } catch (error) { setState({ kind: 'error', message: error instanceof Error ? error.message : 'Your settings could not be saved.' }); }
  }
  return <form onSubmit={save} className={ui.form} noValidate>
    <fieldset className={ui.group}><legend>Email me when</legend>
      {FLAGS.map(flag => <label key={flag.key} className={ui.check}><input type="checkbox" checked={prefs[flag.key]} onChange={e => { setPrefs({ ...prefs, [flag.key]: e.currentTarget.checked }); setDirty(true); setState({ kind: 'idle', message: '' }); }} /><span>{flag.label}{flag.hint && <small>{flag.hint}</small>}</span></label>)}
    </fieldset>
    <fieldset className={ui.group}><legend>Mute a channel</legend>
      {initial.channels.length === 0 ? <p className={ui.notice}>No channels are available to mute yet.</p> : <div className={ui['muted-grid']} role="group" aria-label="Muted alerts per channel">
        <span>Channel</span>{EVENTS.map(([, label]) => <span key={label}>{label}</span>)}
        {initial.channels.map(channel => <div key={channel.id} style={{ display: 'contents' }}>
          <span>{channel.name}</span>
          {EVENTS.map(([ev, label]) => { const key = `${channel.id}|${ev}`; return <input key={key} type="checkbox" aria-label={`Mute ${label.toLowerCase()} for ${channel.name}`} checked={mutes.has(key)} onChange={e => { const next = new Set(mutes); if (e.currentTarget.checked) next.add(key); else next.delete(key); setMutes(next); setDirty(true); setState({ kind: 'idle', message: '' }); }} />; })}
        </div>)}
      </div>}
    </fieldset>
    <div className={ui['row-actions']}><button type="submit" disabled={state.kind === 'saving' || !dirty}>{state.kind === 'saving' ? 'Saving...' : 'Save settings'}</button></div>
    <p role={state.kind === 'error' ? 'alert' : 'status'} className={state.kind === 'error' ? ui.error : ui.notice} hidden={!state.message}>{state.message}</p>
  </form>;
}
