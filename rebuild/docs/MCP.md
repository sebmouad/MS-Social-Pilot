# MCP access in the rebuild

This describes implemented behavior, not a claim of complete UI/API/MCP parity. The endpoint is `/api/mcp`; it accepts JSON-RPC JSON POST requests. Authenticated GET returns 405 with `Allow: POST`. Protocol and authentication responses are `no-store`. Current protocol negotiation supports `2025-06-18`, `2025-03-26` and `2024-11-05`.

## Authentication contexts

| Endpoint | Identity and authority |
| --- | --- |
| `/api/mcp?scope=workspace` | Current membership, permitted workspace role, feature entitlements and scoped permissions. Root tools are unavailable, including to an installation-owner session. |
| `/api/mcp?scope=installation` | Fully verified, active installation-owner browser session. No workspace membership or workspace permissions are required. Only private Root tools/resources are available. Workspace bearer keys are rejected. |
| `/api/mcp` | Existing automatic workspace selection for sessions; an owner falls back to installation context when no usable membership/role/grants exist. A workspace key always uses its stored workspace and scopes. |

Malformed/repeated `scope` parameters are rejected. An Authorization header always determines authentication; an invalid, revoked or inappropriate bearer never falls back to the browser cookie. API keys do not inherit the creator's installation-owner suspension-inspection exception. Explicit workspace sessions also disable that exception. Normal owner-session inspection remains available in the automatic combined context.

Create workspace keys in Settings → MCP API keys. The full token is shown once, stored only as a hash, fixed to its workspace and intersected with the creator's current role, feature/channel scope, installation availability and selected-resource rules. Keys cannot acquire Root authority. Sign in and complete any required verification before using session access. Installation-scoped bearer issuance and OAuth authorization are not implemented.

Global `mcp.enabled`, request-body/result limits and configured request budgets still apply. Installation session requests have a per-owner rate identity; changing context does not invent a workspace identity. Workspace roles come from `mcp.authenticatedRoles`; this setting does not grant or revoke private installation authority.

## Discover and call

Workspace clients can use the API key in their Authorization header. For example, a Node environment with `MSP_ORIGIN` and `MSP_MCP_TOKEN` set can list its available tools:

```js
const response = await fetch(new URL('/api/mcp?scope=workspace', process.env.MSP_ORIGIN), {
  method: 'POST',
  headers: {
    authorization: `Bearer ${process.env.MSP_MCP_TOKEN}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
});
console.log(await response.json());
```

A trusted same-origin client using the verified owner's browser session can POST the same request to `/api/mcp?scope=installation`. Root overview provides its endpoint copy action. The path alone does not authenticate the caller.

Use `initialize`, `tools/list` and `resources/list` to discover the current surface. Tool definitions supply argument schemas and exact confirmation formats. Writes must repeat the exact action/resource confirmation. Provider grants and actual resource availability are checked again by shared domain services; tool metadata alone is not proof that a remote operation will succeed.

The implemented private tools are `get_root_config`, `set_root_config`, `list_root_workspaces`, `set_root_workspace_access`, `list_root_activity`, `list_root_users` and `manage_root_user`. Private resources are `msp://root/config`, `msp://root/workspaces`, `msp://root/activity` and `msp://root/users`. Root operations recheck current owner/disabled state. Configuration reads mask secrets; config changes and workspace access changes commit their domain audit atomically. Installation context refuses forced customer workspace calls before data/provider access.

User controls use the same exact email/action confirmations as the UI. Shared transactions recheck current Root authority, lock actor/target rows and commit changes with their domain audit. Self controls, the last active owner and owner second-factor reset remain protected. User reads expose safe metadata and active verified session counts, never credential/factor material.

Root audit history accepts literal action/person search, exact workspace ID, inclusive UTC dates, bounded limits and filter-bound older/newer cursors. Raw audit payloads are omitted. Continue with the same filters, or reset to the latest page when the cursor becomes invalid.

## Errors and write receipts

Tool failures use `result.isError: true`; text and `structuredContent` contain the same public `error` and stable `code`. Only intentionally typed product errors retain their messages. Unexpected database, provider, storage and configuration exceptions are masked. Resource failures use JSON-RPC `error` with the safe operation code in `error.data.code`. Protocol/authentication errors remain JSON-RPC transport errors; responses are `no-store`.

Malformed argument containers are rejected before tool dispatch. Analytics rejects rolled-over calendar dates rather than silently interpreting them as another day. Validation, unavailable selections, permissions, reconnect requirements and state conflicts remain actionable; internal paths, provider payloads and Root setup instructions do not become customer errors.

A normal returned receipt describes the service outcome. Workspace writes with an additional MCP audit now include `mcpAuditRecorded`. If that secondary insert fails after the service returned, the outcome stays available with `mcpAuditRecorded: false` and a do-not-repeat warning. It does not erase a separate domain audit or guarantee one exists. Ads creation retains its existing `confirmedSuccess`, domain `auditRecorded` and `mcpAuditRecorded` receipt.

An unexpected write error means the outcome could not be confirmed. Check the app and relevant remote state before repeating it, especially for publishing, replies and paid operations. Remote actions and local persistence are not one transaction; durable reconciliation, operation-specific idempotency and fully durable audit coverage remain release requirements. The response boundary alone does not solve those gaps.

## Evidence and gaps

The guarded local script `scripts/verify-installation-mcp.ts` exercises actual password/TOTP login, pending-session denial, a zero-membership owner, private discovery, config audit, owner-created workspace-key isolation, disposable workspace suspension/restoration, UI recovery, demotion/disable denial and cleanup. Set `REBUILD_PREVIEW_ORIGIN` explicitly and use the isolated seeded loopback `_preview` database; the script rejects remote/production-shaped targets and prints no credentials.

See `PREVIEW_QA.md` for actual checks. Remaining work includes the rest of Root and customer capability parity, durable remote-write reconciliation and audit coverage, wider client interoperability, provider verification and the migration/rollback/cutover gates. Production still runs the legacy application.


`get_root_config` schema version 34 includes safe setting ownership metadata. Clients can group controls into shared infrastructure, product modules and platform modules using `definition.owner`; do not infer provider ownership from legacy key prefixes. The same validated `set_root_config` action applies from every module screen. This exposes configuration ownership, not a new provider engine or complete module-health/operation parity.
