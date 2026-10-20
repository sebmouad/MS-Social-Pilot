/** Default operator copy for the Root operations page. */
export const ROOT_OPERATIONS_COPY = {
  metadataTitle: 'Operations · Root',
  eyebrow: 'Root · Control center',
  title: 'Operations',
  intro: 'Background worker heartbeat and recorded sync attempts.'
} as const;

export type RootOperationsCopy = { [K in keyof typeof ROOT_OPERATIONS_COPY]: string };
