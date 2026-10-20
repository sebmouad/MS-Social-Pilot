export const workspacePolicyCopy = {
  en: {
    title: 'Workspace policies', description: 'Set the publishing time zone and review requirement for {workspace}.',
    unavailable: 'Workspace policies are unavailable. Refresh the page or try again later.',
    zonePanel: 'Publishing time zone', zoneDetail: 'Used to display and schedule publishing times across this workspace.',
    approvalNote: 'When approval is required, new scheduled posts from contributors wait in review. Owners, admins, and editors keep their publishing bypass. Editing an approved post clears its previous review so contributors must obtain approval for the changed content and destinations.',
    timezone: 'Time zone', timezoneHint: 'Enter a valid IANA time zone, such as Europe/Paris or UTC.',
    requireApproval: 'Require approval for new scheduled posts by contributors', confirmation: 'Type this confirmation to save',
    save: 'Save workspace policies', saving: 'Saving…', saved: 'Workspace policies saved.',
    unconfirmed: 'The workspace policy outcome is unconfirmed. Refresh before trying again.', failed: 'Workspace policies could not be confirmed.',
  },
  fr: {
    title: 'Politiques de l’espace', description: 'Définissez le fuseau horaire de publication et l’exigence de validation pour {workspace}.',
    unavailable: 'Les politiques de l’espace sont indisponibles. Actualisez la page ou réessayez plus tard.',
    zonePanel: 'Fuseau horaire de publication', zoneDetail: 'Utilisé pour afficher et planifier les heures de publication dans cet espace.',
    approvalNote: 'Lorsque la validation est requise, les nouvelles publications planifiées par des contributeurs attendent une relecture. Les propriétaires, administrateurs et éditeurs conservent leur dérogation. Modifier une publication approuvée annule sa relecture précédente : les contributeurs doivent obtenir une nouvelle validation pour le contenu et les destinations modifiés.',
    timezone: 'Fuseau horaire', timezoneHint: 'Saisissez un fuseau horaire IANA valide, comme Europe/Paris ou UTC.',
    requireApproval: 'Exiger une validation pour les nouvelles publications planifiées par les contributeurs', confirmation: 'Saisissez cette confirmation pour enregistrer',
    save: 'Enregistrer les politiques', saving: 'Enregistrement…', saved: 'Politiques de l’espace enregistrées.',
    unconfirmed: 'Le résultat de la mise à jour des politiques n’est pas confirmé. Actualisez avant de réessayer.', failed: 'Impossible de confirmer les politiques de l’espace.',
  },
} as const;
