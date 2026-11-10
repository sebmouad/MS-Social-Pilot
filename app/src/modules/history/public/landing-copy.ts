import type { SiteLocale } from './content';

/**
 * The public front page (`/`). It tells a visitor, and Meta's reviewer, what the product does and what it does with
 * Facebook and Instagram data before anyone signs in. `{product}` is filled with the operator's product name.
 */
export type LandingFeature = { key: 'publish' | 'inbox' | 'insights' | 'ads' | 'instagram' | 'team'; title: string; body: string };
export type LandingCopy = {
  title: string; lead: string; signIn: string; signUp: string;
  featuresTitle: string; features: readonly LandingFeature[];
  dataTitle: string; dataLead: string; dataPoints: readonly string[];
  privacy: string; dataDeletion: string; terms: string;
};

export const LANDING_COPY: Record<SiteLocale, LandingCopy> = {
  en: {
    title: 'Plan, publish and answer on Facebook and Instagram from one place',
    lead: '{product} is a workspace for the people who run Facebook Pages and Instagram professional accounts: schedule posts, reply to comments and messages, read your results and manage your Meta ad campaigns.',
    signIn: 'Sign in', signUp: 'Create an account',
    featuresTitle: 'What you can do',
    features: [
      { key: 'publish', title: 'Publish and schedule', body: 'Write a post once, add photos or video, and send it now or at a planned time to the Pages and Instagram accounts you choose. A calendar shows everything that is planned.' },
      { key: 'inbox', title: 'Answer in one inbox', body: 'Comments on your posts and messages sent to your Page arrive in one list. Reply, like, hide or delete a comment without leaving the app.' },
      { key: 'insights', title: 'Read your results', body: 'Followers, reach, views and engagement for each Page, Instagram account and post, with reports you can download.' },
      { key: 'ads', title: 'Manage Meta ads', body: 'See spend and results for your ad accounts, and create, pause or edit campaigns, ad sets and ads. New campaigns start paused.' },
      { key: 'instagram', title: 'Instagram with your Pages', body: 'The Instagram professional accounts linked to your Pages come with the same Facebook connection: publish, answer comments and read insights.' },
      { key: 'team', title: 'Work as a team', body: 'Invite teammates, decide which channels each one can use, and approve posts before they go out.' },
    ],
    dataTitle: 'How we use Facebook and Instagram data',
    dataLead: 'You connect with Facebook Login and choose the Pages, Instagram accounts and ad accounts to share. Then:',
    dataPoints: [
      'The app acts only when you, or a teammate you invited, ask it to: publish, reply, hide, sync or create a campaign.',
      'Your data is shown only to the members of your workspace. We do not sell it or use it for advertising.',
      'Access tokens are encrypted before they are stored.',
      'You can disconnect at any time in Settings › Channels, or remove the app in your Facebook settings: the stored access is deleted at once.',
    ],
    privacy: 'Privacy policy', dataDeletion: 'How to delete your data', terms: 'Terms of use',
  },
  fr: {
    title: 'Planifiez, publiez et répondez sur Facebook et Instagram depuis un seul endroit',
    lead: '{product} est un espace de travail pour celles et ceux qui gèrent des Pages Facebook et des comptes professionnels Instagram : programmer des publications, répondre aux commentaires et aux messages, lire vos résultats et gérer vos campagnes publicitaires Meta.',
    signIn: 'Se connecter', signUp: 'Créer un compte',
    featuresTitle: 'Ce que vous pouvez faire',
    features: [
      { key: 'publish', title: 'Publier et programmer', body: 'Rédigez une publication une seule fois, ajoutez des photos ou une vidéo, et envoyez-la maintenant ou à l’heure prévue vers les Pages et comptes Instagram de votre choix. Un calendrier montre tout ce qui est prévu.' },
      { key: 'inbox', title: 'Répondre dans une seule boîte', body: 'Les commentaires sur vos publications et les messages envoyés à votre Page arrivent dans une seule liste. Répondez, aimez, masquez ou supprimez un commentaire sans quitter l’application.' },
      { key: 'insights', title: 'Lire vos résultats', body: 'Abonnés, couverture, vues et engagement pour chaque Page, compte Instagram et publication, avec des rapports à télécharger.' },
      { key: 'ads', title: 'Gérer les publicités Meta', body: 'Consultez les dépenses et les résultats de vos comptes publicitaires, et créez, mettez en pause ou modifiez campagnes, ensembles de publicités et publicités. Les nouvelles campagnes démarrent en pause.' },
      { key: 'instagram', title: 'Instagram avec vos Pages', body: 'Les comptes professionnels Instagram liés à vos Pages arrivent avec la même connexion Facebook : publier, répondre aux commentaires et lire les statistiques.' },
      { key: 'team', title: 'Travailler en équipe', body: 'Invitez des collègues, décidez des canaux que chacun peut utiliser et validez les publications avant leur envoi.' },
    ],
    dataTitle: 'Comment nous utilisons les données Facebook et Instagram',
    dataLead: 'Vous vous connectez avec Facebook Login et choisissez les Pages, comptes Instagram et comptes publicitaires à partager. Ensuite :',
    dataPoints: [
      'L’application n’agit que lorsque vous, ou un collègue que vous avez invité, le demandez : publier, répondre, masquer, synchroniser ou créer une campagne.',
      'Vos données ne sont montrées qu’aux membres de votre espace de travail. Nous ne les vendons pas et ne les utilisons pas à des fins publicitaires.',
      'Les jetons d’accès sont chiffrés avant d’être enregistrés.',
      'Vous pouvez vous déconnecter à tout moment dans Paramètres › Canaux, ou retirer l’application dans vos paramètres Facebook : l’accès enregistré est supprimé aussitôt.',
    ],
    privacy: 'Politique de confidentialité', dataDeletion: 'Comment supprimer vos données', terms: 'Conditions d’utilisation',
  },
};
