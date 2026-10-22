/** This identity has no workspace context and can never enter workspace dispatch. */
export type PersonMcpIdentity = {
  scope: 'person'; userId: string; personKeyId: string; readFeature: 'agency/overview';
  apiKeyId?: never; isInstanceOwner?: never; workspaceId?: never;
};
export type PersonKeySummary = { id: string; name: string; tokenPrefix: string; expiresAt: string; createdAt: string; labels?: { expiresAt?: string } };
export const personKeyCreateConfirmation = (name: string, days: number) => `CREATE AGENCY KEY ${name.trim()} ${days} DAYS`;
export const personKeyRevokeConfirmation = (id: string) => `REVOKE AGENCY KEY ${id}`;
