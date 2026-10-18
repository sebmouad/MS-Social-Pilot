/**
 * Provider-neutral Ads management contract. Platform modules implement
 * AdsOpsHost and advertise only the operations they actually execute; shared
 * services validate, confirm, record and dispatch without provider knowledge.
 */
export type AdsObjectType = 'campaign' | 'adset' | 'ad';
export type AdsOperationId = 'status.set' | 'budget.set' | 'rename' | 'creative.assign' | 'delete';

export type AdsNeutralOperation =
  | { type: 'status.set'; objectType: AdsObjectType; objectId: string; status: 'active' | 'paused' }
  | { type: 'budget.set'; objectType: 'campaign' | 'adset'; objectId: string; budget: { kind: 'daily' | 'lifetime'; minor: number } }
  | { type: 'rename'; objectType: AdsObjectType; objectId: string; name: string }
  | { type: 'creative.assign'; objectType: 'ad'; objectId: string; creativeId: string }
  | { type: 'delete'; objectType: AdsObjectType; objectId: string };

/** Neutral description of one input an operation needs, so shared UI/MCP can render a form without provider knowledge. */
export type AdsOperationInput =
  | { name: 'status'; kind: 'choice'; options: readonly { value: string; label: string }[] }
  | { name: 'budget'; kind: 'money-minor'; budgetKinds: readonly ('daily' | 'lifetime')[] }
  | { name: 'name'; kind: 'text' }
  | { name: 'creativeId'; kind: 'creative-ref' };

export type AdsOpsLimits = { nameMaxCharacters: number; maxBudgetMinor: number };

export type AdsOperationSupport = {
  id: AdsOperationId;
  objectTypes: readonly AdsObjectType[];
  /** True when the operation can start or increase spend; surfaced as a stronger warning. */
  spendChanging: boolean;
  label: string;
  /** Inputs beyond the object reference; absent when none are needed (for example delete). */
  inputs?: readonly AdsOperationInput[];
  /** True when the effect cannot be undone; surfaced as a stronger warning. */
  irreversible?: boolean;
};

export type AdsCreativeSummary = { id: string; name: string | null; status: string | null; title: string | null; body: string | null; thumbnailUrl: string | null };
export type AdsOpsCredential = { accessToken: string };
export type AdsOpsContext = { credential: AdsOpsCredential; accountId: string; signal?: AbortSignal };
export type AdsOpsFailureKind = 'rejected' | 'uncertain';

export interface AdsOpsHost {
  readonly provider: string;
  readonly operations: readonly AdsOperationSupport[];
  /** Throws OperationError('invalid_request') for malformed input. */
  validate(operation: AdsNeutralOperation, limits?: AdsOpsLimits): void;
  /** Exact text a caller must repeat; module-owned so shared code carries no provider wording. */
  confirmation(operation: AdsNeutralOperation, context: { adAccountId: string; currency: string | null }): string;
  execute(context: AdsOpsContext, operation: AdsNeutralOperation): Promise<{ remoteId?: string }>;
  /** Only a definite provider rejection may be classified as rejected; everything else is uncertain. */
  classifyFailure(error: unknown): AdsOpsFailureKind;
  listCreatives?(context: AdsOpsContext, page: { limit: number; after?: string }): Promise<{ items: AdsCreativeSummary[]; next: string | null }>;
}

export const AD_OBJECT_TYPES: readonly AdsObjectType[] = ['campaign', 'adset', 'ad'];
export const AD_OPERATION_IDS: readonly AdsOperationId[] = ['status.set', 'budget.set', 'rename', 'creative.assign', 'delete'];
