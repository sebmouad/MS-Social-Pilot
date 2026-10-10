/**
 * Privacy policy — « Politique de confidentialité ».
 *
 * Meta links here from the Facebook Login dialog and the app's details, so,
 * like the terms and the data deletion page, it sits outside the signed-in
 * layout. French first, as the business is, then English for Meta's reviewers.
 */

const CONTROLLER = 'ANASSO TRAVAUX';
const CONTACT_EMAIL = 'sebmouad@gmail.com';
const UPDATED = { fr: '10 octobre 2026', en: '10 October 2026' };

interface Section {
  title: string;
  body: React.ReactNode;
}

const mail = (
  <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
    {CONTACT_EMAIL}
  </a>
);
const deletion = (label: string) => (
  <a className="underline" href="/data-deletion">
    {label}
  </a>
);

const FR: Section[] = [
  {
    title: 'Qui sommes-nous',
    body: (
      <>
        MS Social Pilot (https://social.newsgeet.com) est un outil de publication et de statistiques pour les
        personnes qui gèrent des Pages Facebook. Le responsable du traitement est {CONTROLLER}, Maroc. Contact :{' '}
        {mail}.
      </>
    ),
  },
  {
    title: 'Les données que nous traitons',
    body: (
      <ul className="list-disc space-y-1 pl-5">
        <li>Votre compte : nom, adresse e-mail et mot de passe (stocké uniquement sous forme chiffrée irréversible).</li>
        <li>
          Ce que Facebook nous transmet quand vous connectez votre profil avec Facebook Login : votre nom et
          identifiant Facebook, la liste des Pages et comptes publicitaires que vous gérez, et les jetons
          d&apos;accès correspondants.
        </li>
        <li>
          Les données des Pages que vous choisissez de connecter : publications, commentaires, messages,
          statistiques (portée, vues, interactions, abonnés) et résultats publicitaires.
        </li>
        <li>Ce que vous créez dans l&apos;application : textes, images et vidéos des publications, programmations.</li>
        <li>Des journaux techniques (date, adresse IP, erreurs) pour la sécurité et le bon fonctionnement.</li>
      </ul>
    ),
  },
  {
    title: 'Pourquoi',
    body: (
      <>
        Uniquement pour fournir le service que vous demandez : publier et programmer vos publications, afficher
        les statistiques de vos Pages, répondre aux commentaires et messages, et produire vos rapports.
        L&apos;application n&apos;agit que lorsque vous (ou un membre invité de votre espace de travail) le
        demandez. Nous ne vendons pas vos données, ne les utilisons pas pour de la publicité et ne les
        partageons avec aucun tiers à des fins commerciales.
      </>
    ),
  },
  {
    title: 'Qui y a accès',
    body: (
      <>
        Seuls les membres de votre espace de travail voient ses données. Nos prestataires techniques les
        hébergent pour notre compte : IKOULA (serveurs en France) et Cloudflare (acheminement sécurisé). Les
        données sont envoyées à Meta uniquement pour exécuter vos actions (publier, répondre, masquer).
      </>
    ),
  },
  {
    title: 'Sécurité',
    body: (
      <>
        Les jetons Facebook sont chiffrés (AES-256) avant d&apos;être enregistrés, les connexions passent par
        HTTPS et l&apos;accès au serveur est restreint.
      </>
    ),
  },
  {
    title: 'Durée de conservation',
    body: (
      <>
        Les données sont conservées tant que votre compte ou la connexion Facebook existe. Quand vous
        déconnectez un profil ou retirez l&apos;application de Facebook, le profil et tous ses jetons
        d&apos;accès sont supprimés et ses Pages cessent d&apos;être lues ou publiées. Les publications et
        statistiques déjà enregistrées sont effacées sur simple demande, dans un délai de 30 jours. Les
        sauvegardes quotidiennes sont effacées automatiquement après 14 jours.
      </>
    ),
  },
  {
    title: 'Vos droits',
    body: (
      <>
        Vous pouvez accéder à vos données, les corriger, les supprimer ou vous opposer à leur traitement
        (loi marocaine 09-08 et, le cas échéant, RGPD) en écrivant à {mail}. Vous pouvez aussi retirer
        l&apos;accès de l&apos;application depuis les paramètres de Facebook (Applications et sites web) :
        Facebook nous le signale et votre profil et ses jetons sont alors supprimés — voir la{' '}
        {deletion('page de suppression des données')}.
      </>
    ),
  },
  {
    title: 'Cookies',
    body: (
      <>
        Un seul cookie, nécessaire pour vous garder connecté. Aucun cookie publicitaire ni de mesure
        d&apos;audience.
      </>
    ),
  },
  {
    title: 'Modifications',
    body: <>Toute modification sera publiée sur cette page avec sa date de mise à jour.</>,
  },
];

const EN: Section[] = [
  {
    title: 'Who we are',
    body: (
      <>
        MS Social Pilot (https://social.newsgeet.com) is a publishing and analytics tool for people who manage
        Facebook Pages. The data controller is {CONTROLLER}, Morocco. Contact: {mail}.
      </>
    ),
  },
  {
    title: 'The data we process',
    body: (
      <ul className="list-disc space-y-1 pl-5">
        <li>Your account: name, email address and password (stored only as a one-way hash).</li>
        <li>
          What Facebook gives us when you connect your profile with Facebook Login: your Facebook name and ID,
          the Pages and ad accounts you manage, and the matching access tokens.
        </li>
        <li>
          Data of the Pages you choose to connect: posts, comments, messages, insights (reach, views,
          engagement, followers) and ad results.
        </li>
        <li>What you create in the app: post text, images and videos, schedules.</li>
        <li>Technical logs (time, IP address, errors) for security and reliability.</li>
      </ul>
    ),
  },
  {
    title: 'Why',
    body: (
      <>
        Only to provide the service you ask for: publishing and scheduling your posts, showing your Pages&apos;
        results, answering comments and messages, and building your reports. The app acts only when you (or a
        teammate you invited) ask it to. We do not sell your data, use it for advertising, or share it with
        third parties for their own purposes.
      </>
    ),
  },
  {
    title: 'Who can see it',
    body: (
      <>
        Only the members of your workspace. Our technical providers host it on our behalf: IKOULA (servers in
        France) and Cloudflare (secure delivery). Data is sent to Meta only to carry out your actions
        (publish, reply, hide).
      </>
    ),
  },
  {
    title: 'Security',
    body: (
      <>
        Facebook tokens are encrypted (AES-256) before they are stored, every connection uses HTTPS, and
        server access is restricted.
      </>
    ),
  },
  {
    title: 'Retention',
    body: (
      <>
        Data is kept while your account or Facebook connection exists. When you disconnect a profile or
        remove the app from Facebook, the profile and all its access tokens are deleted and its Pages are no
        longer read or published to. Posts and statistics already stored are erased on request, within 30
        days. Daily backups are erased automatically after 14 days.
      </>
    ),
  },
  {
    title: 'Your rights',
    body: (
      <>
        You can access, correct or delete your data, or object to its processing (Moroccan law 09-08 and, where
        it applies, the GDPR), by writing to {mail}. You can also remove the app from your Facebook settings
        (Apps and websites): Facebook tells us and your profile and its tokens are deleted — see the{' '}
        {deletion('data deletion page')}.
      </>
    ),
  },
  {
    title: 'Cookies',
    body: <>A single cookie that keeps you signed in. No advertising or analytics cookies.</>,
  },
  {
    title: 'Changes',
    body: <>Any change will be published on this page with its update date.</>,
  },
];

function Policy({ lang, title, updated, sections }: { lang: string; title: string; updated: string; sections: Section[] }) {
  return (
    <section lang={lang} className="card p-6 sm:p-8">
      <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 text-xs text-slate-500">{updated}</p>
      {sections.map((section) => (
        <div key={section.title}>
          <h3 className="mt-6 text-sm font-semibold text-slate-900">{section.title}</h3>
          <div className="mt-2 text-sm text-slate-600">{section.body}</div>
        </div>
      ))}
    </section>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-bold text-slate-900">
        Politique de confidentialité <span className="text-slate-400">·</span>{' '}
        <span lang="en">Privacy policy</span>
      </h1>
      <p className="text-sm text-slate-600">
        <a className="underline" href="#en">
          English version below
        </a>
      </p>
      <Policy lang="fr" title="Politique de confidentialité" updated={`Mise à jour le ${UPDATED.fr}`} sections={FR} />
      <div id="en">
        <Policy lang="en" title="Privacy policy" updated={`Last updated ${UPDATED.en}`} sections={EN} />
      </div>
    </main>
  );
}
