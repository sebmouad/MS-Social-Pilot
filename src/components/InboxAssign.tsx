'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

/** Who is dealing with this item: a select over the team, or nobody. */
export function InboxAssign({
  kind,
  id,
  assigneeId,
  members,
}: {
  kind: 'comment' | 'message';
  id: string;
  assigneeId: string | null;
  members: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations('inbox');
  const router = useRouter();
  const [value, setValue] = useState(assigneeId ?? '');
  const [busy, setBusy] = useState(false);

  async function change(next: string) {
    const before = value;
    setValue(next);
    setBusy(true);
    try {
      const response = await fetch('/api/inbox/assign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, id, assigneeId: next || null }),
      });
      if (!response.ok) throw new Error();
      router.refresh();
    } catch {
      setValue(before);
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      className="input h-9 w-auto max-w-[11rem] py-0 text-sm"
      value={value}
      disabled={busy}
      aria-label={t('assignTo')}
      onChange={(event) => void change(event.target.value)}
    >
      <option value="">{t('unassigned')}</option>
      {members.map((member) => (
        <option key={member.id} value={member.id}>
          {member.name}
        </option>
      ))}
    </select>
  );
}
