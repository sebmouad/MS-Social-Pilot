export const accountCopy = {
  en: {
    title: 'Account', description: 'Your profile and the workspace context used for this session.',
    contextTitle: 'Workspace context', workspace: 'Workspace', role: 'Your role', timezone: 'Workspace time zone', slug: 'Workspace slug',
    profile: 'Profile', profileDetail: 'Update the name shown to your team.', name: 'Name', email: 'Email',
    emailNote: 'Email changes require a verified address and are not available yet.', saveProfile: 'Save profile',
    nameRequired: 'Enter a name for your profile.', profileFailed: 'Could not update profile.', profileUpdated: 'Profile updated.',
    password: 'Password', passwordDetail: 'Changing your password signs out other active sessions.',
    currentPassword: 'Current password', newPassword: 'New password', changePassword: 'Change password',
    passwordTooLong: 'Use no more than {max} bytes.', passwordRule: 'Use at least {min} characters, up to {max} bytes.',
    passwordFailed: 'Could not change password.', passwordChanged: 'Password changed. Other active sessions were signed out.',
    sessions: 'Active sessions', sessionsDetail: 'Sign out sessions you no longer recognize. This browser is marked as current.',
    session: 'Session', expires: 'Expires', currentSession: 'This browser · current', otherSession: 'Signed-in session',
    signOut: 'Sign out', noSessions: 'No active sessions found.', sessionsFailed: 'Could not load sessions.',
    revokeFailed: 'Could not revoke session.', sessionRevoked: 'Session signed out.',
  },
  fr: {
    title: 'Compte', description: 'Votre profil et le contexte d’espace utilisé pour cette session.',
    contextTitle: 'Contexte de l’espace', workspace: 'Espace', role: 'Votre rôle', timezone: 'Fuseau horaire de l’espace', slug: 'Identifiant de l’espace',
    profile: 'Profil', profileDetail: 'Modifiez le nom affiché à votre équipe.', name: 'Nom', email: 'E-mail',
    emailNote: 'La modification de l’e-mail exige une adresse vérifiée et n’est pas encore disponible.', saveProfile: 'Enregistrer le profil',
    nameRequired: 'Saisissez un nom pour votre profil.', profileFailed: 'Impossible de mettre à jour le profil.', profileUpdated: 'Profil mis à jour.',
    password: 'Mot de passe', passwordDetail: 'Changer votre mot de passe déconnecte vos autres sessions actives.',
    currentPassword: 'Mot de passe actuel', newPassword: 'Nouveau mot de passe', changePassword: 'Changer le mot de passe',
    passwordTooLong: 'Utilisez au maximum {max} octets.', passwordRule: 'Utilisez au moins {min} caractères, jusqu’à {max} octets.',
    passwordFailed: 'Impossible de changer le mot de passe.', passwordChanged: 'Mot de passe modifié. Les autres sessions actives ont été déconnectées.',
    sessions: 'Sessions actives', sessionsDetail: 'Déconnectez les sessions que vous ne reconnaissez pas. Ce navigateur est marqué comme session actuelle.',
    session: 'Session', expires: 'Expire le', currentSession: 'Ce navigateur · actuelle', otherSession: 'Session connectée',
    signOut: 'Se déconnecter', noSessions: 'Aucune session active.', sessionsFailed: 'Impossible de charger les sessions.',
    revokeFailed: 'Impossible de déconnecter la session.', sessionRevoked: 'Session déconnectée.',
  },
} as const;

export { fill } from '../shell-copy';
