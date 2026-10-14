# Rebuild entitlement checks

`src/server/entitlements` is the server-side boundary for product access in the rebuild. It reads the existing workspace and membership `disabledModules` switches and the subscriber's `Plan.features`; it does not add columns or require a migration.

```ts
const access = await loadEntitlements(userId, workspaceId);
if (!access) throw new EntitlementDeniedError('module', 'workspace');
requireFeature(access, 'publishing/posts');
```

Use `canUseModule` or `canUseFeature` when composing navigation or returning a boolean. The rebuild viewer context accepts a module or feature requirement and checks it before returning to page data loaders; `PageFrame` also checks the active module and passes only enabled modules and pages to customer navigation. Use the corresponding `require*` helper at server actions, route handlers, and MCP tool dispatch before reading or changing protected data. MCP tool and resource listings omit unavailable features, and tool/resource reads check access again before querying data. Missing memberships and unknown IDs deny access. The exception carries HTTP status 403 for adapters that need an HTTP response.

Root's legacy module keys map as follows: `schedule` to publishing, `analytics` to analytics and inbox, and `ads` to ads. Workspace and member switches are combined, so either level can disable access. Root feature keys are mapped from the old catalog (for example `ads/performance` gates both rebuild Ads pages, and `analytics/inbox` gates the inbox). Home, connection settings, account settings, and appearance have no legacy feature switch. A plan without `product_v2` keeps legacy unrestricted feature behavior; a `product_v2` plan must list the mapped feature key for access.

Platform add-ons are separate capabilities. Check them with `hasPlatformCapability(access, 'instagram')`; they do not imply that publishing, analytics, or any other product feature is enabled.

Workspace suspension denies customer access, while the installation owner retains access for support. This policy is applied when loading entitlements from the authenticated user and workspace membership.
