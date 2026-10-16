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

The implemented private tools are `get_root_config`, `set_root_config`, `list_root_workspaces`, `set_root_workspace_access` and `list_root_activity`. Private resources are `msp://root/config`, `msp://root/workspaces` and `msp://root/activity`. Root operations recheck current owner/disabled state. Configuration reads mask secrets; config changes and workspace access changes commit their domain audit atomically. Installation context refuses forced customer workspace calls before data/provider access.

Root audit history accepts literal action/person search, exact workspace ID, inclusive UTC dates, bounded limits and filter-bound older/newer cursors. Raw audit payloads are omitted. Continue with the same filters, or reset to the latest page when the cursor becomes invalid.

## Evidence and gaps

The guarded local script `scripts/verify-installation-mcp.ts` exercises actual password/TOTP login, pending-session denial, a zero-membership owner, private discovery, config audit, owner-created workspace-key isolation, disposable workspace suspension/restoration, UI recovery, demotion/disable denial and cleanup. Set `REBUILD_PREVIEW_ORIGIN` explicitly and use the isolated seeded loopback `_preview` database; the script rejects remote/production-shaped targets and prints no credentials.

See `PREVIEW_QA.md` for actual checks. Remaining work includes the rest of Root and customer capability parity, generic workspace tool error hardening, wider client interoperability, provider verification and the migration/rollback/cutover gates. Production still runs the legacy application.
