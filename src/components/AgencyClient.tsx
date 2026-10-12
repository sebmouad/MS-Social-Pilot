'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { FeedAvatar } from './FeedPost';

const ROLES = ['admin', 'editor', 'contributor', 'viewer'] as const;

interface Client {
  id: string;
  name: string;
  logoUrl: string | null;
  channels: number;
  scheduled: number;
}

interface Person {
  id: string;
  name: string;
  email: string;
  roles: Record<string, string>;
}

/** The agency: client cards, then a people × clients grid with a role in each cell. */
export function AgencyClient({ clients, people, currentId }: { clients: Client[]; people: Person[]; currentId: string }) {
  const t = useTranslations('agency');
  const tRoles = useTranslations('team.roles');
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function open(id: string) {
    if (id !== currentId) {
      const response = await fetch('/api/workspace/switch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: id }),
      });
      if (!response.ok) return;
    }
    router.push('/dashboard');
    router.refresh();
  }

  async function setRole(person: Person, client: Client, role: string) {
    const key = `${person.id}:${client.id}`;
    setBusy(key);
    setMessage(null);
    const response = await fetch('/api/agency/access', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: client.id, userId: person.id, role: role || null }),
    }).catch(() => null);
    setBusy(null);
    if (response?.ok) {
      setMessage({ ok: true, text: role ? t('granted', { name: person.name, client: client.name, role: tRoles(role) }) : t('removed', { name: person.name, client: client.name }) });
      router.refresh();
    } else {
      const body = (await response?.json().catch(() => ({}))) as { error?: string } | undefined;
      setMessage({ ok: false, text: body?.error ?? t('failed') });
    }
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="agency-clients">
        <h2 id="agency-clients" className="mb-3 text-base font-semibold text-slate-900">
          {t('clients', { count: clients.length })}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {clients.map((client) => (
            <li key={client.id} className="card flex items-center gap-3 p-4">
              <FeedAvatar name={client.name} pictureUrl={client.logoUrl} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-slate-900">{client.name}</p>
                <p className="text-xs text-slate-500">
                  {t('channels', { count: client.channels })} · {t('scheduled', { count: client.scheduled })}
                </p>
              </div>
              <button type="button" className={client.id === currentId ? 'btn-secondary h-9' : 'btn-primary h-9'} onClick={() => void open(client.id)}>
                {client.id === currentId ? t('current') : t('open')}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="agency-access" className="space-y-3">
        <div>
          <h2 id="agency-access" className="text-base font-semibold text-slate-900">{t('access')}</h2>
          <p className="mt-1 text-sm text-slate-600">{t('accessHint')}</p>
        </div>
        {message && (
          <p role="status" className={`rounded-xl px-4 py-2 text-sm ${message.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
            {message.text}
          </p>
        )}
        {people.length === 0 ? (
          <p className="card p-6 text-center text-sm text-slate-600">{t('noTeam')}</p>
        ) : (
          <div className="card scroll-x p-0">
            <table className="w-full text-start text-sm">
              <thead className="border-b border-slate-200 text-xs text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2 text-start font-medium">{t('person')}</th>
                  {clients.map((client) => (
                    <th key={client.id} scope="col" className="min-w-[9rem] px-3 py-2 text-start font-medium">
                      {client.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {people.map((person) => (
                  <tr key={person.id}>
                    <th scope="row" className="px-4 py-2 text-start font-normal">
                      <p className="font-semibold text-slate-900">{person.name}</p>
                      <p className="text-xs text-slate-500">{person.email}</p>
                    </th>
                    {clients.map((client) => {
                      const role = person.roles[client.id] ?? '';
                      const fixed = role === 'owner' || role === 'client';
                      return (
                        <td key={client.id} className="px-3 py-2">
                          {fixed ? (
                            <span className="text-slate-600">{tRoles(role)}</span>
                          ) : (
                            <select
                              className={`input h-9 py-0 ${role ? '' : 'text-slate-400'}`}
                              aria-label={t('roleFor', { name: person.name, client: client.name })}
                              value={role}
                              disabled={busy === `${person.id}:${client.id}`}
                              onChange={(event) => void setRole(person, client, event.target.value)}
                            >
                              <option value="">{t('noAccess')}</option>
                              {ROLES.map((entry) => (
                                <option key={entry} value={entry}>
                                  {tRoles(entry)}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
