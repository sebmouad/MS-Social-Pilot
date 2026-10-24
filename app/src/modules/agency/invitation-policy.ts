import { z } from 'zod';

export const clientInvitationPolicySchema = z.object({
  enabled: z.boolean(),
  lifetimeDays: z.number().int().min(1).max(365),
  listLimit: z.number().int().min(1).max(2000),
  emailMaxLength: z.number().int().min(3).max(320),
  workspaceNameMaxLength: z.number().int().min(1).max(200),
  idMaxLength: z.number().int().min(1).max(2000),
  transactionTimeoutMs: z.number().int().min(1000).max(300000),
  transactionMaxWaitMs: z.number().int().min(100).max(30000),
  registrationPath: z.string().regex(/^\/(?!\/)[A-Za-z0-9/_-]*$/),
}).strict();

export const clientInvitationDefaults = {
  // Keep issuance off until the registration owner mounts token consumption.
  enabled: false, lifetimeDays: 14, listLimit: 100, emailMaxLength: 254,
  workspaceNameMaxLength: 100, idMaxLength: 200,
  transactionTimeoutMs: 15000, transactionMaxWaitMs: 2000, registrationPath: '/register',
};

export const clientInvitationCopy = {
  en: {
    title: 'Client invitations', help: 'Invite a new client to create an account and a workspace of their own. No access to your other workspaces is granted.',
    email: 'Client email', workspaceName: 'Suggested workspace name', optional: 'Optional',
    create: 'Invite client', revoke: 'Revoke invitation', cancel: 'Cancel', exact: 'Type exactly', pending: 'Saving…', retry: 'Reload invitations',
    empty: 'No client invitations yet.', disabled: 'New client invitations are currently unavailable.', truncated: 'More invitations exist. Only the most recent invitations are shown.',
    expires: 'Expires', status: 'Status', accepted: 'Accepted', expired: 'Expired', active: 'Pending',
    createNotice: 'Create an invitation for this client? A previous pending invitation for the same email will stop working.',
    revokeNotice: 'This invitation link will stop working. An account that has already accepted cannot be revoked here.',
    created: 'Invitation created. Copy the link now; it cannot be shown again.', revoked: 'Invitation revoked.',
    link: 'Private invitation link', hideLink: 'Hide link', sent: 'Invitation email sent.',
    mailUnavailable: 'Email delivery was not confirmed. You can share the private link directly.',
    failed: 'This request could not be confirmed. Reload the invitations before trying again.',
    mailSubject: 'Your invitation to MS Social Pilot',
    mailBody: 'Create your account and your own workspace using this private one-use link. It expires on {expiresAt}.\n\n{url}\n\nIf you were not expecting this invitation, you can ignore it.',
  },
  fr: {
    title: 'Invitations clients', help: 'Invitez un nouveau client à créer son compte et son propre espace. Aucun accès à vos autres espaces ne lui sera accordé.',
    email: 'Adresse e-mail du client', workspaceName: 'Nom suggéré pour l’espace', optional: 'Facultatif',
    create: 'Inviter un client', revoke: 'Révoquer l’invitation', cancel: 'Annuler', exact: 'Saisir exactement', pending: 'Enregistrement…', retry: 'Recharger les invitations',
    empty: 'Aucune invitation client.', disabled: 'Les nouvelles invitations clients sont actuellement indisponibles.', truncated: 'D’autres invitations existent. Seules les plus récentes sont affichées.',
    expires: 'Expiration', status: 'Statut', accepted: 'Acceptée', expired: 'Expirée', active: 'En attente',
    createNotice: 'Créer une invitation pour ce client ? Toute invitation en attente pour cette même adresse cessera de fonctionner.',
    revokeNotice: 'Ce lien d’invitation cessera de fonctionner. Un compte ayant déjà accepté ne peut pas être révoqué ici.',
    created: 'Invitation créée. Copiez le lien maintenant ; il ne sera plus affiché.', revoked: 'Invitation révoquée.',
    link: 'Lien d’invitation privé', hideLink: 'Masquer le lien', sent: 'E-mail d’invitation envoyé.',
    mailUnavailable: 'L’envoi de l’e-mail n’a pas été confirmé. Vous pouvez partager le lien privé directement.',
    failed: 'Cette demande n’a pas pu être confirmée. Rechargez les invitations avant de réessayer.',
    mailSubject: 'Votre invitation à MS Social Pilot',
    mailBody: 'Créez votre compte et votre propre espace avec ce lien privé à usage unique. Il expire le {expiresAt}.\n\n{url}\n\nSi vous n’attendiez pas cette invitation, vous pouvez l’ignorer.',
  },
};
const catalog = z.object(Object.fromEntries(Object.keys(clientInvitationCopy.en).map(key => [key, z.string().trim().min(1).max(4000)])) as Record<keyof typeof clientInvitationCopy.en, z.ZodString>).strict()
  .superRefine((copy, context) => {
    for (const token of ['{url}', '{expiresAt}']) if (copy.mailBody.split(token).length !== 2) context.addIssue({ code: z.ZodIssueCode.custom, path: ['mailBody'], message: `Mail body must contain ${token} exactly once.` });
  });
export const clientInvitationCopySchema = z.object({ en: catalog, fr: catalog }).strict();
export type ClientInvitationCopy = z.infer<typeof clientInvitationCopySchema>['en'];
export type ClientInvitationPolicy = z.infer<typeof clientInvitationPolicySchema>;

/** Confirmation is a protocol identifier and binds every material issuance field. */
export const clientInviteConfirmation = (email: string, workspaceName: string | null) => `INVITE CLIENT ${JSON.stringify([email.trim().toLowerCase(), workspaceName?.trim() || null])}`;
export const clientRevokeConfirmation = (id: string) => `REVOKE CLIENT INVITATION ${id}`;
