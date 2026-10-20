/** Shared private Root interface copy. Values are plain text; preserve named placeholders. */
export const ROOT_INTERFACE_COPY = {
  en: {
    reset: 'Reset filters', retry: 'Try again', close: 'Close', search: 'Search', filters: 'Active filters', removeFilter: 'Remove filter',
    history: 'Change history', historyDescription: 'Recent configuration changes across the installation. Values and secrets are omitted. Open Activity for the complete available history.',
    historyEmpty: 'No configuration changes recorded.', historyFailure: 'Change history could not be loaded.', historyMore: 'Older changes', historyLatest: 'Latest changes', historyLink: 'Open configuration activity',
    clearTitle: 'Clear saved secret', clearConsequence: 'Remove this saved secret. Operations using it may stop until a replacement is saved.', cancel: 'Cancel',
    invalidNumber: '{label}: enter a finite number.',
    overviewTitle: 'Control center', overviewIntro: 'Review installation state and open the tools that need your attention.',
    users: 'Users', workspaces: 'Workspaces', errors: 'Open errors · last 24 hours', jobs: 'Job health', sources: 'Connected sources', published: 'Published posts',
    unavailable: 'Not available', unknownHealth: 'Health has not been assessed.', storedCounts: 'Stored installation counts', errorsHint: 'Open error groups last seen within 24 hours',
    summaryFailure: 'Installation summary unavailable', summaryHint: 'Stored installation counts could not be loaded. Reload to try again.',
    attention: 'Attention', attentionHint: 'Items below come from stored installation state.', noWorkspace: 'No workspaces have been created.', noSource: 'No connected sources are recorded.', failedPosts: '{count} posts are failed or partially failed.', clearAttention: 'No attention items are indicated by the available stored counts.',
    activity: 'Recent activity', modules: 'Product modules', platforms: 'Platform modules', config: 'Shared configuration', moduleHealth: 'Module health',
    saved: 'Saved.', saveFailure: 'The change could not be confirmed. Review the current state before retrying.', module: 'Module', disableModule: 'Turn off module', disableConsequence: 'Hide this module from all workspaces. Connected data stays stored.', on: 'On', off: 'Off',
    pass: 'Passed', fail: 'Needs attention', unknown: 'Unknown', checkHealth: 'Review recorded module health',
    countsChart: 'Stored content and connection counts', count: 'Count',
  },
  fr: {
    reset: 'Réinitialiser les filtres', retry: 'Réessayer', close: 'Fermer', search: 'Rechercher', filters: 'Filtres actifs', removeFilter: 'Retirer le filtre',
    history: 'Historique des modifications', historyDescription: 'Modifications récentes de la configuration de l’installation. Les valeurs et secrets sont masqués. Ouvrez Activité pour consulter tout l’historique disponible.',
    historyEmpty: 'Aucune modification de configuration enregistrée.', historyFailure: 'Impossible de charger l’historique.', historyMore: 'Modifications précédentes', historyLatest: 'Dernières modifications', historyLink: 'Ouvrir l’activité de configuration',
    clearTitle: 'Effacer le secret enregistré', clearConsequence: 'Supprimer ce secret enregistré. Les opérations qui l’utilisent peuvent s’arrêter jusqu’à son remplacement.', cancel: 'Annuler',
    invalidNumber: '{label} : saisissez un nombre fini.',
    overviewTitle: 'Centre de contrôle', overviewIntro: 'Consultez l’état de l’installation et ouvrez les outils nécessitant votre attention.',
    users: 'Utilisateurs', workspaces: 'Espaces de travail', errors: 'Erreurs ouvertes · dernières 24 heures', jobs: 'État des tâches', sources: 'Sources connectées', published: 'Publications publiées',
    unavailable: 'Non disponible', unknownHealth: 'L’état n’a pas été évalué.', storedCounts: 'Totaux enregistrés de l’installation', errorsHint: 'Groupes d’erreurs ouvertes vus au cours des dernières 24 heures',
    summaryFailure: 'Résumé de l’installation indisponible', summaryHint: 'Impossible de charger les totaux enregistrés. Rechargez pour réessayer.',
    attention: 'À vérifier', attentionHint: 'Ces éléments proviennent de l’état enregistré de l’installation.', noWorkspace: 'Aucun espace de travail créé.', noSource: 'Aucune source connectée enregistrée.', failedPosts: '{count} publications en échec total ou partiel.', clearAttention: 'Aucun élément à vérifier selon les totaux disponibles.',
    activity: 'Activité récente', modules: 'Modules produit', platforms: 'Modules plateforme', config: 'Configuration partagée', moduleHealth: 'État des modules',
    saved: 'Enregistré.', saveFailure: 'La modification n’a pas pu être confirmée. Vérifiez l’état actuel avant de réessayer.', module: 'Module', disableModule: 'Désactiver le module', disableConsequence: 'Masquer ce module dans tous les espaces de travail. Les données connectées restent enregistrées.', on: 'Activé', off: 'Désactivé',
    pass: 'Réussi', fail: 'À vérifier', unknown: 'Inconnu', checkHealth: 'Consulter l’état enregistré des modules',
    countsChart: 'Totaux des contenus et connexions enregistrés', count: 'Nombre',
  },
};
export type RootInterfaceCopy = { [K in keyof typeof ROOT_INTERFACE_COPY.en]: string };
export type RootInterfaceCatalog = { en: RootInterfaceCopy; fr: RootInterfaceCopy };
