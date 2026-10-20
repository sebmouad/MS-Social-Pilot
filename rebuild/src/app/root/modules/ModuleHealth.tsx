import { Badge } from '@/components/Badge';
import { IconActivity } from '@tabler/icons-react';
import { headers } from 'next/headers';
import { requireRootPage } from '@/server/config/access';
import { loadRootModuleHealth } from '@/server/root/module-health';
import { rootCopyLocale } from '@/server/root/legacy/copy';

const copy = {
  en: { title: 'Stored module health', enabled: 'Enabled', disabled: 'Disabled', shared: 'Shared controls', product: 'Product modules', platform: 'Platform modules', pass: 'Pass', fail: 'Fail', unknown: 'Unknown', unavailable: 'Not available', config: 'Configuration validity', jobs: 'Job freshness / last outcome', queues: 'Pending queues', audit: 'Inspection audit', timing: 'Checked at', help: 'Stored evidence only. Unknown means evidence is missing, disabled, unscoped or outside the freshness window. Queue counts alone do not establish health. No provider calls are made.', error: 'Health could not be loaded. Check service availability and reload.', scheduledPosts: 'Due scheduled posts', publicationAttempts: 'Unresolved publication attempts', workspaceExports: 'Pending workspace exports' },
  fr: { title: 'État des modules enregistré', enabled: 'Activé', disabled: 'Désactivé', shared: 'Contrôles partagés', product: 'Modules produit', platform: 'Modules plateforme', pass: 'Réussi', fail: 'Échec', unknown: 'Inconnu', unavailable: 'Non disponible', config: 'Validité de la configuration', jobs: 'Fraîcheur des tâches / dernier résultat', queues: 'Files en attente', audit: 'Audit de consultation', timing: 'Vérifié le', help: 'Données enregistrées uniquement. Inconnu indique des données manquantes, désactivées, sans périmètre ou hors de la fenêtre de fraîcheur. Les nombres en attente ne prouvent pas le bon fonctionnement. Aucun appel fournisseur.', error: 'État indisponible. Vérifiez le service et rechargez.', scheduledPosts: 'Publications planifiées dues', publicationAttempts: 'Tentatives de publication non résolues', workspaceExports: 'Exports en attente' },
};
export async function ModuleHealth({ scope }: { scope?: string }) {
  const actor = await requireRootPage();
  const locale = rootCopyLocale((await headers()).get('accept-language'));
  const t = copy[locale];
  let data;
  try { data = await loadRootModuleHealth(actor.id, scope); }
  catch { return <section className="root-control__notice" role="alert" lang={locale}><h2>{t.title}</h2><p>{t.error}</p></section>; }
  return <section className="root-control__panel" lang={locale}>
    <h2>{t.title}</h2><p>{t.help}</p>
    <p>{t.timing}: <time dateTime={data.checkedAt}>{data.checkedAt}</time> · {data.durationMs} ms</p>
    <p>{t.audit}: <code>{data.id}</code> · <a href="/root/activity">{t.audit}</a></p>
    {(['shared', 'product', 'platform'] as const).map(kind => data.modules.some(m => m.kind === kind) ? <section key={kind}>
      <h3>{t[kind]}</h3>
      {data.modules.filter(m => m.kind === kind).map(m => <article key={m.id}>
        <h4>{m.title} · <Badge tone={m.status === 'pass' ? 'success' : m.status === 'fail' ? 'danger' : 'warning'} icon={<IconActivity size={14} />}>{t[m.status]}</Badge> · {m.durationMs} ms</h4>
        <p>{m.available === true ? t.enabled : m.available === false ? t.disabled : t.unavailable}</p>
        <details><summary>{t.config} · {m.configuration.some(c => c.status === 'fail') ? t.fail : m.configuration.length && m.configuration.every(c => c.status === 'pass') ? t.pass : t.unknown}</summary>
          <ul>{m.configuration.map(c => <li key={c.key}><code>{c.key}</code>: {t[c.status]}</li>)}</ul>
        </details>
        {m.worker ? <p>Worker: {t[m.worker.status]} · {m.worker.seenAt ?? t.unavailable}</p> : null}
        <p>{t.jobs}</p>{m.jobs.length ? <ul>{m.jobs.map(j => <li key={j.name}><code>{j.name}</code>: {t[j.freshness]} / {t[j.outcome]} · {j.startedAt ?? t.unavailable} → {j.finishedAt ?? t.unavailable} · {j.durationMs === null ? t.unavailable : `${j.durationMs} ms`} · {j.runId ?? t.unavailable}</li>)}</ul> : <p>{t.unavailable} · {t.unknown}</p>}
        <p>{t.queues}</p>{m.queues.length ? <ul>{m.queues.map(q => <li key={q.name}>{t[q.name]}: {q.count ?? t.unavailable} · {t[q.status]}</li>)}</ul> : <p>{t.unavailable} · {t.unknown}</p>}
      </article>)}
    </section> : null)}
  </section>;
}
