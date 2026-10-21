import type { Metadata } from 'next';
import { AuthShell } from '@/modules/home/auth/AuthShell';
import { authLocale } from '@/modules/home/auth/locale';
import { deletionRequestStatus } from '@/server/platforms/deletion-status';

export const metadata: Metadata = { title: 'Data deletion status', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';

const copy = {
  en: {
    title: 'Data deletion request', lead: 'Check the outcome of a removal request sent from your Facebook settings.',
    completed: (count: number, when: string) => `Done on ${when}. We removed the stored access for ${count} ${count === 1 ? 'connection' : 'connections'} and stopped its scheduled work.`,
    kept: 'Posts that were already published belong to the workspace that managed the Page. Its owner can delete them from Settings.',
    unknown: 'We found no record for this code. If you used Facebook’s removal option, no access linked to your account was held here.',
    invalid: 'This code is not valid. Open the link shown in your Facebook settings again.',
    home: 'Back to sign in',
  },
  fr: {
    title: 'Demande de suppression des données', lead: 'Consultez le résultat d’une demande de suppression envoyée depuis vos paramètres Facebook.',
    completed: (count: number, when: string) => `Terminé le ${when}. Nous avons supprimé l’accès enregistré pour ${count} ${count === 1 ? 'connexion' : 'connexions'} et arrêté ses tâches planifiées.`,
    kept: 'Les publications déjà parues appartiennent à l’espace de travail qui gérait la Page. Son propriétaire peut les supprimer depuis les Paramètres.',
    unknown: 'Aucun enregistrement n’existe pour ce code. Si vous avez utilisé l’option de suppression de Facebook, aucun accès lié à votre compte n’était conservé ici.',
    invalid: 'Ce code n’est pas valide. Ouvrez à nouveau le lien affiché dans vos paramètres Facebook.',
    home: 'Retour à la connexion',
  },
} as const;

export default async function DataDeletionPage({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  const locale = await authLocale();
  const t = copy[locale];
  const raw = (await searchParams).code;
  const status = await deletionRequestStatus(Array.isArray(raw) ? raw[0] : raw);
  const when = status.state === 'completed' ? new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(status.completedAt) : '';
  return <AuthShell locale={locale} title={t.title} lead={t.lead} footer={<a href="/sign-in">{t.home}</a>}>
    <p role="status">{status.state === 'completed' ? t.completed(status.connections, when) : status.state === 'unknown' ? t.unknown : t.invalid}</p>
    {status.state === 'completed' && <p>{t.kept}</p>}
  </AuthShell>;
}
