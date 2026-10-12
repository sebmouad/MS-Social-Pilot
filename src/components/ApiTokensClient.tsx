'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Dialog } from './Dialog';
import { EmptyState } from './EmptyState';
import { Icon } from './Icon';

/** The MCP clients the setup guide covers, each with its own steps. */
const ASSISTANTS = ['claudeCode', 'claudeDesktop', 'cursor', 'vscode'] as const;
type Assistant = (typeof ASSISTANTS)[number];

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  scope: 'read' | 'write';
  owner: string;
  created: string;
  lastUsed: string | null;
  revoked: boolean;
}

function CopyField({ value, label, copyLabel, copiedLabel, multiline = false }: { value: string; label: string; copyLabel: string; copiedLabel: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      {multiline ? (
        <pre className="scroll-x rounded-lg bg-slate-900 p-3 pe-20 font-mono text-xs leading-relaxed text-slate-100" aria-label={label}>
          {value}
        </pre>
      ) : (
        <input className="input pe-24 font-mono text-xs" readOnly value={value} aria-label={label} onFocus={(event) => event.target.select()} />
      )}
      <button
        type="button"
        className={`absolute end-1.5 top-1.5 rounded-md px-2.5 py-1 text-xs font-semibold ${multiline ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-brand-500 text-white hover:bg-brand-600'}`}
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => setCopied(true)).catch(() => setCopied(false));
        }}
      >
        {copied ? copiedLabel : copyLabel}
      </button>
    </div>
  );
}

/**
 * API keys: make one, see it once, connect it to Claude in one command.
 */
export function ApiTokensClient({ tokens, baseUrl, showOwner }: { tokens: TokenRow[]; baseUrl: string; showOwner: boolean }) {
  const t = useTranslations('apiKeys');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'write'>('write');
  const [made, setMade] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState<TokenRow | null>(null);
  const [assistant, setAssistant] = useState<Assistant>('claudeCode');
  const close = useCallback(() => {
    setOpen(false);
    setMade(null);
    setError(null);
    setName('');
  }, []);

  async function create() {
    setPending(true);
    setError(null);
    const response = await fetch('/api/api-tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), scope }),
    }).catch(() => null);
    setPending(false);
    const body = (await response?.json().catch(() => ({}))) as { token?: string; error?: string } | undefined;
    if (!response?.ok || !body?.token) {
      setError(body?.error ?? tCommon('genericError'));
      return;
    }
    setMade(body.token);
    router.refresh();
  }

  async function revoke(row: TokenRow) {
    await fetch(`/api/api-tokens/${row.id}`, { method: 'DELETE' }).catch(() => null);
    setConfirming(null);
    router.refresh();
  }

  const mcpUrl = `${baseUrl}/api/mcp`;
  const key = made ?? 'msp_YOUR_KEY';
  const claudeCommand = `claude mcp add --transport http ms-social-pilot ${mcpUrl} \\\n  --header "Authorization: Bearer ${key}"`;
  // What each assistant needs pasted, and how many steps its guide has.
  const guides: Record<Assistant, { snippet: string; steps: number }> = {
    claudeCode: { snippet: claudeCommand, steps: 3 },
    // Claude Desktop reaches a remote server through the mcp-remote bridge.
    claudeDesktop: {
      snippet: JSON.stringify(
        {
          mcpServers: {
            'ms-social-pilot': {
              command: 'npx',
              args: ['-y', 'mcp-remote', mcpUrl, '--header', 'Authorization:${AUTH_HEADER}'],
              env: { AUTH_HEADER: `Bearer ${key}` },
            },
          },
        },
        null,
        2,
      ),
      steps: 4,
    },
    cursor: {
      snippet: JSON.stringify({ mcpServers: { 'ms-social-pilot': { url: mcpUrl, headers: { Authorization: `Bearer ${key}` } } } }, null, 2),
      steps: 3,
    },
    vscode: {
      snippet: JSON.stringify(
        { servers: { 'ms-social-pilot': { type: 'http', url: mcpUrl, headers: { Authorization: `Bearer ${key}` } } } },
        null,
        2,
      ),
      steps: 3,
    },
  };
  const guide = guides[assistant];
  const curl = `curl ${baseUrl}/api/v1/pages \\\n  -H "Authorization: Bearer ${key}"`;
  const copy = { copyLabel: t('copy'), copiedLabel: t('copied') };

  return (
    <div className="space-y-6">
      <section className="card divide-y divide-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <h2 className="text-[15px] font-semibold text-slate-900">{t('keys')}</h2>
          <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
            <Icon name="plus" size={16} />
            {t('newKey')}
          </button>
        </div>
        {tokens.length === 0 ? (
          <div className="p-2">
            <EmptyState icon="link" title={t('none')} hint={t('noneHint')} />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {tokens.map((row) => (
              <li key={row.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${row.revoked ? 'opacity-55' : ''}`}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 font-mono text-xs font-bold text-slate-600">
                  {row.scope === 'write' ? 'RW' : 'R'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-slate-900">
                    {row.name} <span className="font-mono text-xs font-normal text-slate-500">{row.prefix}…</span>
                  </span>
                  <span className="block truncate text-xs text-slate-500">
                    {t(`scope_${row.scope}`)}
                    {showOwner && ` · ${row.owner}`} · {t('createdOn', { when: row.created })} ·{' '}
                    {row.lastUsed ? t('lastUsed', { when: row.lastUsed }) : t('neverUsed')}
                  </span>
                </span>
                {row.revoked ? (
                  <span className="badge bg-slate-100 text-slate-600">{t('revoked')}</span>
                ) : (
                  <button type="button" className="btn-secondary px-3 py-1 text-xs hover:text-red-600" onClick={() => setConfirming(row)}>
                    {t('revoke')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-4 p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
            <Icon name="link" size={18} />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">{t('mcpTitle')}</h2>
            <p className="text-sm text-slate-600">{t('mcpHint')}</p>
          </div>
        </div>
        <div className="segmented w-fit max-w-full flex-wrap" role="radiogroup" aria-label={t('mcpAssistant')}>
          {ASSISTANTS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={assistant === value}
              className={`segmented-item ${assistant === value ? 'segmented-item-active' : ''}`}
              onClick={() => setAssistant(value)}
            >
              {t(`mcpName_${value}`)}
            </button>
          ))}
        </div>
        <ol className="list-decimal space-y-3 ps-5 text-sm text-slate-700">
          <li>{tokens.some((row) => !row.revoked) ? t('mcpStepKeyHave') : t('mcpStepKey')}</li>
          {Array.from({ length: guide.steps - 1 }, (_, index) => (
            <li key={index} className="space-y-1.5">
              <span>{t(`mcpStep_${assistant}_${index + 1}`)}</span>
              {index === 0 && <CopyField value={guide.snippet} label={t(`mcpName_${assistant}`)} multiline {...copy} />}
            </li>
          ))}
        </ol>
        <p className="text-xs text-slate-500">{t('mcpTools')}</p>
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="text-[15px] font-semibold text-slate-900">{t('restTitle')}</h2>
        <p className="text-sm text-slate-600">{t('restHint')}</p>
        <CopyField value={curl} label={t('restTitle')} multiline {...copy} />
        <ul className="space-y-1 font-mono text-xs text-slate-700">
          <li>GET  /api/v1/pages</li>
          <li>GET  /api/v1/pages/:id/analytics?days=30</li>
          <li>GET  /api/v1/posts?status=scheduled&amp;from=…&amp;to=…</li>
          <li>POST /api/v1/posts</li>
        </ul>
      </section>

      <Dialog
        open={open}
        title={made ? t('madeTitle') : t('newKey')}
        onClose={close}
        closeLabel={tCommon('close')}
        wide={Boolean(made)}
        footer={
          made ? (
            <button type="button" className="btn-primary" onClick={close}>
              {tCommon('close')}
            </button>
          ) : (
            <>
              <button type="button" className="btn-secondary" onClick={close}>
                {tCommon('cancel')}
              </button>
              <button type="button" className="btn-primary" disabled={pending || !name.trim()} onClick={() => void create()}>
                {pending ? tCommon('working') : t('create')}
              </button>
            </>
          )
        }
      >
        {made ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">{t('madeHint')}</p>
            <CopyField value={made} label={t('keyLabel')} {...copy} />
            <div className="space-y-1.5">
              <p className="text-[13px] font-semibold text-slate-700">{t('mcpCode')}</p>
              <CopyField value={claudeCommand} label={t('mcpCode')} multiline {...copy} />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <div>
              <label className="label" htmlFor="key-name">
                {t('nameField')}
              </label>
              <input
                id="key-name"
                className="input"
                maxLength={60}
                placeholder={t('namePlaceholder')}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t('scopeLabel')}>
              {(['write', 'read'] as const).map((value) => (
                <label
                  key={value}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${
                    scope === value ? 'border-brand-400 bg-brand-50/60' : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="key-scope"
                    className="mt-0.5 h-4 w-4 border-slate-300 text-brand-500 focus:ring-brand-500"
                    checked={scope === value}
                    onChange={() => setScope(value)}
                  />
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">{t(`scope_${value}`)}</span>
                    <span className="block text-xs text-slate-600">{t(`scopeHint_${value}`)}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="text-xs text-slate-500">{t('actsAsYou')}</p>
          </div>
        )}
      </Dialog>

      <Dialog
        open={confirming !== null}
        title={t('revokeTitle', { name: confirming?.name ?? '' })}
        onClose={() => setConfirming(null)}
        closeLabel={tCommon('close')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setConfirming(null)}>
              {t('keep')}
            </button>
            <button type="button" className="btn-primary bg-red-600 hover:bg-red-700" onClick={() => confirming && void revoke(confirming)}>
              {t('revoke')}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-700">{t('revokeHint')}</p>
      </Dialog>
    </div>
  );
}
