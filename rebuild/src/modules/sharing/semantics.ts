/**
 * Feature semantics the host mirrors in its shared entitlement and permission tables
 * (see docs/CLIENT_SHARING.md, "Host wiring"). Client sharing and the public bio page are two
 * independent Settings features, so a plan or role can grant one without the other.
 */
export const SHARING_MODULE_ID = 'settings';
export const SHARING_FEATURE_ID = 'settings/sharing';
export const BIO_FEATURE_ID = 'settings/bio';
/**
 * Publishing features a link of each kind exposes. The creator must hold read on all of them, now (at creation,
 * narrowed by any key ceiling) and at every public request, or the link serves nothing.
 */
export const KIND_PUBLISHING_FEATURES = { review: ['publishing/approvals'], calendar: ['publishing/calendar'], portal: ['publishing/approvals', 'publishing/calendar'] } as const;
export const PUBLISHING_FEATURES: readonly string[] = ['publishing/approvals', 'publishing/calendar', 'publishing/posts'];
export type SharingArea = 'sharing' | 'bio';
export const AREA_FEATURE: Readonly<Record<SharingArea, string>> = { sharing: SHARING_FEATURE_ID, bio: BIO_FEATURE_ID };

/** Only an active workspace owner or admin manages sharing; every other role is refused at the service. */
export const SHARING_MANAGER_ROLES: readonly string[] = ['owner', 'admin'];

/** MCP tool -> feature and access, so the host gates discovery and calls on the same entitlement as the screen. */
export const SHARING_TOOL_ACCESS = {
  list_share_links: { feature: SHARING_FEATURE_ID, mode: 'read' },
  list_shareable_channels: { feature: SHARING_FEATURE_ID, mode: 'read' },
  list_share_feedback: { feature: SHARING_FEATURE_ID, mode: 'read' },
  create_share_link: { feature: SHARING_FEATURE_ID, mode: 'write' },
  update_share_link: { feature: SHARING_FEATURE_ID, mode: 'write' },
  revoke_share_link: { feature: SHARING_FEATURE_ID, mode: 'write' },
  rotate_share_link: { feature: SHARING_FEATURE_ID, mode: 'write' },
  delete_share_link: { feature: SHARING_FEATURE_ID, mode: 'write' },
  get_bio_page: { feature: BIO_FEATURE_ID, mode: 'read' },
  save_bio_page: { feature: BIO_FEATURE_ID, mode: 'write' },
  delete_bio_page: { feature: BIO_FEATURE_ID, mode: 'write' },
} as const;
export type SharingToolName = keyof typeof SHARING_TOOL_ACCESS;
