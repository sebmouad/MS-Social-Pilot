/** Workspace member email switches retained from legacy NotificationSetting. */
export const ADDITIONAL_NOTIFICATION_PREFERENCES = [
  'onPublishFailure', 'onTokenExpiry', 'onApprovalRequest', 'onApprovalDecision',
  'onNewInbox', 'onDraftUpdated', 'onModerationAlert',
  'onMetricAlert', 'onReportDelivered', 'onTriageAssigned',
] as const;

export const notificationPreferenceLabels = {
  en: {
    onPublishFailure: 'Publication failures and disconnected connections',
    onTokenExpiry: 'Connections approaching expiry',
    onApprovalRequest: 'Posts awaiting approval',
    onApprovalDecision: 'Decisions on your posts',
    onNewInbox: 'Hourly inbox digest (opt in)',
    onDraftUpdated: 'Changes to your unpublished posts',
    onModerationAlert: 'Moderation alerts and negative comment spikes',
    onMetricAlert: 'Metric alert firings',
    onReportDelivered: 'Scheduled report deliveries',
    onTriageAssigned: 'Inbox items assigned to you',
    pending: 'Email delivery follows your personal preferences.',
  },
  fr: {
    onPublishFailure: 'Échecs de publication et connexions interrompues',
    onTokenExpiry: 'Connexions arrivant à expiration',
    onApprovalRequest: 'Publications en attente de validation',
    onApprovalDecision: 'Décisions sur vos publications',
    onNewInbox: 'Résumé horaire de la boîte de réception (sur inscription)',
    onDraftUpdated: 'Modifications de vos publications non publiées',
    onModerationAlert: 'Alertes de modération et hausse des commentaires négatifs',
    onMetricAlert: 'Déclenchements d’alertes de mesure',
    onReportDelivered: 'Envois de rapports planifiés',
    onTriageAssigned: 'Éléments assignés pour triage',
    pending: 'La diffusion par e-mail suit vos préférences personnelles.',
  },
} as const;
