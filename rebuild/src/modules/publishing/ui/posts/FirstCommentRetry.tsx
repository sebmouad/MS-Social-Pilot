'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { useConfirm } from '@/components/useConfirm';

export const firstCommentRetryCopy = {
  en: {
    retry: 'Retry failed first comment', title: 'Retry this first comment?', cancel: 'Cancel',
    description: 'The platform definitely rejected the previous attempt. Send the saved comment again now, overriding its saved delay. An uncertain result will stay held for review.',
    confirmation: 'Type to confirm', pending: 'Retrying…', failed: 'The retry could not be completed. Refresh Posts and review the current comment state.',
    held: 'The result is uncertain. Close this dialog and refresh Posts to review the outcome before another action.',
    sent: 'First comment recorded as sent.', rejected: 'The platform rejected the comment again. Review it before making a separately confirmed retry.',
    status: 'First comment failed: the platform rejected it.', unavailable: 'Not available',
  },
  fr: {
    retry: 'Réessayer le premier commentaire échoué', title: 'Réessayer ce premier commentaire ?', cancel: 'Annuler',
    description: 'La plateforme a définitivement refusé la tentative précédente. Envoyer à nouveau le commentaire enregistré maintenant, sans attendre le délai prévu. Un résultat incertain restera bloqué pour vérification.',
    confirmation: 'Saisissez pour confirmer', pending: 'Nouvelle tentative…', failed: 'La nouvelle tentative a échoué. Actualisez les publications et vérifiez l’état actuel du commentaire.',
    held: 'Le résultat est incertain. Fermez cette fenêtre et actualisez les publications pour vérifier le résultat avant toute autre action.',
    sent: 'Premier commentaire enregistré comme envoyé.', rejected: 'La plateforme a de nouveau refusé le commentaire. Vérifiez-le avant une nouvelle tentative confirmée séparément.',
    status: 'Échec du premier commentaire : la plateforme l’a refusé.', unavailable: 'Non disponible',
  },
};

type State = 'sent' | 'ready' | 'needs_review';
export function FirstCommentRetry({ postId, postTargetId, destinationName, onSettled }: { postId: string; postTargetId: string; destinationName?: string | null; onSettled: (state: State) => void }) {
  const [locale, setLocale] = useState<'en' | 'fr'>('en');
  useEffect(() => { setLocale(/^fr\b/i.test(document.documentElement.lang || navigator.language) ? 'fr' : 'en'); }, []);
  const c = firstCommentRetryCopy[locale];
  const router = useRouter();
  const running = useRef(false);
  const held = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirm, dialog] = useConfirm({ title: c.title, cancel: c.cancel, confirm: c.retry, danger: false });

  async function retry() {
    if (running.current) return;
    running.current = true; setBusy(true); setMessage('');
    let outcome: State | undefined;
    try {
      await confirm(`${destinationName ?? c.unavailable}: ${c.description}`, {
        exactConfirmation: `RETRY FIRST COMMENT ${postTargetId}`, confirmationLabel: c.confirmation, pendingLabel: c.pending, failureLabel: c.held,
        onConfirm: async () => {
          if (held.current) return c.held;
          try {
            const response = await fetch('/api/publishing/first-comments/retry', { method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ postId, postTargetId, confirmation: `RETRY FIRST COMMENT ${postTargetId}` }) });
            const result = await response.json().catch(() => null);
            if (!response.ok) {
              if (['invalid_request', 'forbidden', 'unauthorized', 'not_found', 'unavailable'].includes(result?.code)) return c.failed;
              throw new Error('Unconfirmed retry');
            }
            if (result?.ok !== true || result.postId !== postId || result.postTargetId !== postTargetId || !['sent', 'ready', 'needs_review'].includes(result.state)) throw new Error('Unconfirmed retry');
            if (result.state === 'needs_review') throw new Error('Uncertain retry');
            outcome = result.state;
            setMessage(result.state === 'sent' ? c.sent : c.rejected);
            return null;
          } catch {
            held.current = true; outcome = 'needs_review'; return c.held;
          }
        },
      });
      if (outcome) {
        onSettled(outcome);
        try { router.refresh(); } catch { /* Keep the known local result. */ }
      }
    } finally { running.current = false; setBusy(false); }
  }

  return <>
    <span>{c.status}</span>
    <Button size="sm" disabled={busy || held.current} onClick={() => void retry()}>{c.retry}</Button>
    {message && <p role="status">{message}</p>}
    {dialog}
  </>;
}
