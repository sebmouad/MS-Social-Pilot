import { z } from 'zod';
import { entry } from '@/lib/config/entry';
import { copySchema } from '@/lib/config/copy-schema';

const language = {
  name: 'MS Social Pilot', shortName: 'Social Pilot', description: 'Your publishing and measurement workspace.',
  title: 'Keep your workspace close', detail: 'Open Social Pilot from your home screen. An internet connection is needed to view or change your workspace.',
  prepare: 'Prepare installation', install: 'Install app', cancel: 'Cancel', confirm: 'Continue',
  confirmTitle: 'Add Social Pilot to this device', confirmDetail: 'Prepare the app for installation. Your browser will ask before adding it. Private workspace pages are never saved for offline use.',
  preparing: 'Preparing…', prepared: 'Ready. Use Install app or your browser’s Add to home screen menu.',
  installed: 'The app is installed on this device.', unsupported: 'Use your browser’s Install app or Add to home screen menu if available.',
  failed: 'Installation could not be prepared. Check your connection and try again.', dismissed: 'Installation was cancelled. You can try again.',
  offlineTitle: 'You are offline', offlineDetail: 'Reconnect to open your workspace. Publishing runs on the server; check the latest status when you are back online.', retry: 'Try again',
};
const fr: typeof language = {
  name: 'MS Social Pilot', shortName: 'Social Pilot', description: 'Votre espace de publication et de mesure.',
  title: 'Votre espace à portée de main', detail: 'Ouvrez Social Pilot depuis votre écran d’accueil. Une connexion Internet est nécessaire pour consulter ou modifier votre espace.',
  prepare: 'Préparer l’installation', install: 'Installer l’application', cancel: 'Annuler', confirm: 'Continuer',
  confirmTitle: 'Ajouter Social Pilot à cet appareil', confirmDetail: 'Préparez l’application pour l’installation. Votre navigateur demandera votre accord avant de l’ajouter. Les pages privées ne sont jamais enregistrées pour une utilisation hors ligne.',
  preparing: 'Préparation…', prepared: 'Tout est prêt. Choisissez Installer l’application ou Ajouter à l’écran d’accueil dans votre navigateur.',
  installed: 'L’application est installée sur cet appareil.', unsupported: 'Utilisez Installer l’application ou Ajouter à l’écran d’accueil dans votre navigateur, si disponible.',
  failed: 'La préparation a échoué. Vérifiez votre connexion et réessayez.', dismissed: 'L’installation a été annulée. Vous pouvez réessayer.',
  offlineTitle: 'Vous êtes hors ligne', offlineDetail: 'Reconnectez-vous pour ouvrir votre espace. Les publications sont envoyées depuis le serveur ; vérifiez leur statut une fois la connexion rétablie.', retry: 'Réessayer',
};
const localPath = z.string().max(300).regex(/^\/(?!\/)[A-Za-z0-9/_-]*$/);
export const webAppSchema = z.object({
  requestTimeoutMs: z.number().int().min(1000).max(300000),
  enabled: z.boolean(), startUrl: localPath, scope: z.literal('/'), display: z.enum(['standalone', 'minimal-ui']),
  themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/), backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/), inkColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  darkBackgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/), darkInkColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  iconText: z.string().trim().min(1).max(3), iconTextColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  cacheRevision: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/),
  copy: z.object({ en: copySchema(language), fr: copySchema(fr) }).strict(),
}).strict();
export type WebAppPolicy = z.infer<typeof webAppSchema>;
export type WebAppCopy = WebAppPolicy['copy']['en'];
export const WEB_APP_DEFAULTS: WebAppPolicy = {
  requestTimeoutMs: 15000,
  enabled: true, startUrl: '/', scope: '/', display: 'standalone', themeColor: '#286b4b', backgroundColor: '#f5f7f4', inkColor: '#18231e',
  darkBackgroundColor: '#18231e', darkInkColor: '#f5f7f4',
  iconText: 'SP', iconTextColor: '#ffffff', cacheRevision: 'v1', copy: { en: language, fr },
};
export const WEB_APP_CONFIG = [entry({ key: 'settings.webApp', group: 'Settings · Web app', label: 'Installable app branding and offline copy', kind: 'json', description: 'Public English/French app identity, icon mark, colors, start path, install availability and offline cache revision. Public branding only: never place private information here. Change the revision after offline-copy changes so installed browsers retire the old fallback.', defaultValue: WEB_APP_DEFAULTS, schema: webAppSchema, consumption: 'active' })] as const;
