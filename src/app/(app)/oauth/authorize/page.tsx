import { getTranslations } from 'next-intl/server';

import { ScreenHeader } from '@/components/ScreenHeader';
import { requirePage } from '@/lib/auth';
import { findClient } from '@/lib/oauth';
import { screenMetadata } from '@/lib/metadata';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('oauth.title');
}

/**
 * The consent screen an MCP client (the Claude web connector) sends people to.
 * Allowing makes an API key that acts as root in this workspace; it is listed
 * and revoked under Settings › API keys like any other.
 */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requirePage();
  const t = await getTranslations('oauth');
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? '';
  };
  const client = await findClient(one('client_id'));
  const redirectUri = one('redirect_uri');
  const valid =
    client &&
    client.redirectUris.includes(redirectUri) &&
    one('response_type') === 'code' &&
    one('code_challenge_method') === 'S256' &&
    /^[A-Za-z0-9_-]{43}$/.test(one('code_challenge'));
  const asked = one('scope').split(/\s+/);

  // Reaching this screen at all needs developer features and root (`DEVELOPER_PATHS`), like API keys.
  const problem = valid ? null : t('invalid');

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <ScreenHeader title={t('title')} subtitle={t('subtitle', { workspace: auth.workspace.name })} />
      {problem || !client ? (
        <p role="alert" className="card p-4 text-sm text-red-700">{problem}</p>
      ) : (
        <form method="post" action="/api/oauth/authorize" className="card space-y-4 p-5">
          <p className="text-sm text-slate-700">
            {t.rich('ask', { client: client.name, host: new URL(redirectUri).host, b: (chunks) => <strong>{chunks}</strong> })}
          </p>
          <fieldset className="space-y-2">
            <legend className="label">{t('scopeLabel')}</legend>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="radio" name="scope" value="read" defaultChecked={!asked.includes('write')} className="mt-1" />
              <span>{t('scopeRead')}</span>
            </label>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="radio" name="scope" value="write" defaultChecked={asked.includes('write')} className="mt-1" />
              <span>{t('scopeWrite')}</span>
            </label>
          </fieldset>
          <p className="hint">{t('revokeHint')}</p>
          {(['client_id', 'redirect_uri', 'state', 'code_challenge'] as const).map((key) => (
            <input key={key} type="hidden" name={key} value={one(key)} />
          ))}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="submit" name="decision" value="deny" className="btn-secondary">{t('deny')}</button>
            <button type="submit" name="decision" value="allow" className="btn-primary">{t('allow')}</button>
          </div>
        </form>
      )}
    </div>
  );
}
