import type { AuthLocale } from './auth/copy';

const en = {
  eyebrow: 'Workspace overview', lead: 'Your connected channels and recent publishing activity.', metrics: 'Workspace figures',
  channels: 'Connected channels', adAccounts: 'Linked ad accounts', published: 'Published posts', scheduled: 'Scheduled posts',
  firstStep: 'First step', startTitle: 'Choose the channels you want to manage',
  startBody: 'Connect a platform, then select the channels and ad accounts to add to this workspace. Only selected sources appear in publishing and reports.', startAction: 'Connect channels',
  continueTitle: 'Continue your work', posts: 'Browse posts', connections: 'View connections', analytics: 'Explore analytics', ads: 'View ad accounts',
};

export const homeCopy = (locale: AuthLocale): typeof en => locale === 'fr' ? {
  eyebrow: 'Vue d’ensemble de l’espace', lead: 'Vos canaux connectés et l’activité de publication récente.', metrics: 'Chiffres de l’espace',
  channels: 'Canaux connectés', adAccounts: 'Comptes publicitaires liés', published: 'Publications publiées', scheduled: 'Publications planifiées',
  firstStep: 'Première étape', startTitle: 'Choisissez les canaux à gérer',
  startBody: 'Connectez une plateforme, puis sélectionnez les canaux et comptes publicitaires à ajouter à cet espace. Seules les sources sélectionnées apparaissent dans la publication et les rapports.', startAction: 'Connecter des canaux',
  continueTitle: 'Reprenez votre travail', posts: 'Parcourir les publications', connections: 'Voir les connexions', analytics: 'Explorer les statistiques', ads: 'Voir les comptes publicitaires',
} : en;
