export const productivityCopy = {
  en: {
    region: 'Inbox productivity', assignment: 'Assignment', assignTo: 'Assign to', unassigned: 'Unassigned', teammate: 'Teammate', assignedTo: (name: string) => `Assigned to ${name}`,
    notes: 'Private notes', note: 'Private note', notePlaceholder: 'Add a note for your team', addNote: 'Add note', notesHelp: 'Only your workspace team can see these notes.', deleteNote: 'Delete note',
    savedReplies: 'Saved replies', noReplies: 'No saved replies yet', noRepliesBody: 'Save the answers you give often and insert them into a reply with one click.',
    useReply: 'Use reply', replyActions: (name: string) => `Actions for ${name}`, edit: 'Edit', delete: 'Delete',
    replyName: 'Saved reply name', replyNamePlaceholder: 'Reply name', replyText: 'Saved reply text', replyTextPlaceholder: 'Reply text', createReply: 'Create saved reply', saveReply: 'Save reply', cancelEdit: 'Cancel edit',
    loadError: 'Inbox productivity could not be loaded.', unconfirmed: 'Action outcome is unconfirmed. Inspect before trying again.', unconfirmedShort: 'Action outcome is unconfirmed.',
    confirmTitle: 'Please confirm', cancel: 'Cancel', deleteConfirm: 'Delete', deleteNoteAsk: 'Delete this private note? This cannot be undone.', deleteReplyAsk: 'Delete this saved reply for the whole team? This cannot be undone.',
    done: { assign: 'Assignment updated.', noteAdded: 'Note added.', noteDeleted: 'Note deleted.', replyCreated: 'Saved reply created.', replyUpdated: 'Saved reply updated.', replyDeleted: 'Saved reply deleted.' },
  },
  fr: {
    region: 'Outils de la boîte de réception', assignment: 'Attribution', assignTo: 'Attribuer à', unassigned: 'Non attribuée', teammate: 'Collègue', assignedTo: (name: string) => `Attribuée à ${name}`,
    notes: 'Notes privées', note: 'Note privée', notePlaceholder: 'Ajoutez une note pour votre équipe', addNote: 'Ajouter la note', notesHelp: 'Seule l’équipe de votre espace de travail voit ces notes.', deleteNote: 'Supprimer la note',
    savedReplies: 'Réponses enregistrées', noReplies: 'Aucune réponse enregistrée', noRepliesBody: 'Enregistrez les réponses que vous donnez souvent et insérez-les en un clic.',
    useReply: 'Utiliser la réponse', replyActions: (name: string) => `Actions pour ${name}`, edit: 'Modifier', delete: 'Supprimer',
    replyName: 'Nom de la réponse enregistrée', replyNamePlaceholder: 'Nom de la réponse', replyText: 'Texte de la réponse enregistrée', replyTextPlaceholder: 'Texte de la réponse', createReply: 'Créer la réponse enregistrée', saveReply: 'Enregistrer la réponse', cancelEdit: 'Annuler la modification',
    loadError: 'Les outils de la boîte de réception n’ont pas pu être chargés.', unconfirmed: 'Le résultat de l’action n’est pas confirmé. Vérifiez avant de réessayer.', unconfirmedShort: 'Le résultat de l’action n’est pas confirmé.',
    confirmTitle: 'Veuillez confirmer', cancel: 'Annuler', deleteConfirm: 'Supprimer', deleteNoteAsk: 'Supprimer cette note privée ? Cette action est irréversible.', deleteReplyAsk: 'Supprimer cette réponse enregistrée pour toute l’équipe ? Cette action est irréversible.',
    done: { assign: 'Attribution mise à jour.', noteAdded: 'Note ajoutée.', noteDeleted: 'Note supprimée.', replyCreated: 'Réponse enregistrée créée.', replyUpdated: 'Réponse enregistrée mise à jour.', replyDeleted: 'Réponse enregistrée supprimée.' },
  },
} as const;
