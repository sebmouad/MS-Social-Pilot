# Root registration administration

Branch batch, 2026-10-20. UI `/root/registration`, GET `/api/root/registration`,
DELETE `/api/root/registration/invitations/:id`, and POST/DELETE
`/api/root/registration/accounts/:id` share `server/root/registration-admin.ts`.
No servers, installation, client generation, migrations, deployment or push were
performed. This is unit/render/DOM evidence, not production or integration proof.

The directory displays the actual `auth.openRegistration` boolean read-only and
links to `/root/config?search=auth.openRegistration`. Shared configuration now
honors that initial search. Invitation email/workspace search, exact workspace ID,
status filters and independent account/invitation pages are bounded by existing
`root.legacy.lifecycleListLimit` / `root.legacy.searchMaxCharacters`. A supplied
MCP result ceiling further narrows both pages. Extra fetched rows enable Next;
there is no fabricated total. Missing dates/state are explicitly unavailable.

Current active installation-owner authority is mandatory, independent of workspace
membership. HTTP uses verified browser sessions, rejects cross-origin writes,
unknown/repeated query parameters and unexpected body fields, sends no-store
responses and masks unexpected errors. Service reads recheck current authority;
mutations lock/recheck the actor and affected accounts inside the transaction.

Settings owns invitation state expressions and the shared locked revoke transition.
Accepted invitations cannot be revoked. Root can revoke owner invitations without
workspace membership, but suspension/purge guards still apply. The supplied
workspace ID is part of the locked invitation lookup and delete. Revocation and
`root.invitation_revoked` audit are atomic.

Settings registration owns the shared eligibility predicate: null verification,
non-Root, no memberships and an `account.registered` audit whose method is
`open_registration`. This excludes invited/legacy accounts without that evidence.
Target locks protect verification/membership changes before deletion or resend.
Deletion relies on production FK cascades for personal authentication data and
SetNull for historical Root activity. Unexpected restrictive references abort;
workspace content is not reassigned or deleted. The account delete and
`root.unverified_registration_deleted` audit share a transaction.

Resend uses the original availability, TTL, token replacement and verification
mail helpers. Registration must be open, mail ready and target active. It holds
the Root and target locks through mail submission; its transaction stores
`root.registration_verification_resent` with delivery status and no token/address.
Only a `sent` mail receipt produces UI success. Failed, unavailable and uncertain
receipts stay explicit. If mail succeeds but the final transaction/audit fails,
the response cannot confirm the action and the token may have rolled back; inspect
mail/account state before retrying. Atomic database audit is not atomic SMTP.

English/French copy, shared DataTable/Button and useConfirm handle exact typed
confirmations, pending state, retained input/error, cancellation and success.
The optional async exact-confirmation mode in useConfirm leaves its original
simple boolean API intact. Filters and paging live in the contextual sidebar.

## MCP definitions to register during integration

**Not registered by this batch.** Per worktree instruction,
`server/root/legacy/mcp.ts` is untouched. The host must expose these only in
installation context, reject workspace/API-key identities, use its current Root
actor, enforce the MCP result limit, and dispatch to the same service below.
No alternate domain implementation is needed.

Each input schema is strict (`additionalProperties: false`). Write confirmations
are case-sensitive protocol phrases, identical in both UI languages. Mark the
three mutations as writes and require the exact confirmation before dispatch.

```json
[
  {
    "name": "list_root_registration",
    "description": "Inspect open-registration status, workspace invitations and unverified self-registrations installation-wide.",
    "inputSchema": {
      "type": "object", "additionalProperties": false,
      "properties": {
        "q": { "type": "string", "maxLength": 2000 },
        "workspaceId": { "type": "string", "minLength": 1, "maxLength": 255 },
        "status": { "type": "string", "enum": ["pending", "expired", "accepted"] },
        "page": { "type": "integer", "minimum": 1, "maximum": 100000 },
        "accountsPage": { "type": "integer", "minimum": 1, "maximum": 100000 }
      }
    }
  },
  {
    "name": "revoke_root_invitation",
    "description": "Revoke an unaccepted invitation in the exact workspace. Requires REVOKE INVITATION <invitationId>.",
    "inputSchema": {
      "type": "object", "additionalProperties": false,
      "required": ["workspaceId", "invitationId", "confirmation"],
      "properties": {
        "workspaceId": { "type": "string", "minLength": 1, "maxLength": 255 },
        "invitationId": { "type": "string", "minLength": 1, "maxLength": 255 },
        "confirmation": { "type": "string", "maxLength": 400 }
      }
    }
  },
  {
    "name": "resend_root_registration_verification",
    "description": "Replace the verification link for an eligible self-registration and report mail delivery honestly. Requires RESEND VERIFICATION <userId>.",
    "inputSchema": {
      "type": "object", "additionalProperties": false,
      "required": ["userId", "confirmation"],
      "properties": {
        "userId": { "type": "string", "minLength": 1, "maxLength": 255 },
        "confirmation": { "type": "string", "maxLength": 400 }
      }
    }
  },
  {
    "name": "delete_root_unverified_registration",
    "description": "Delete an unverified non-Root self-registration without memberships and its personal authentication data. Requires DELETE UNVERIFIED ACCOUNT <userId>.",
    "inputSchema": {
      "type": "object", "additionalProperties": false,
      "required": ["userId", "confirmation"],
      "properties": {
        "userId": { "type": "string", "minLength": 1, "maxLength": 255 },
        "confirmation": { "type": "string", "maxLength": 400 }
      }
    }
  }
]
```

| Tool | Service dispatch |
| --- | --- |
| `list_root_registration` | `listRootRegistration(actorId, args, maxResults)` |
| `revoke_root_invitation` | `revokeRootRegistrationInvitation(actorId, args.workspaceId, args.invitationId, { confirmation: args.confirmation })` |
| `resend_root_registration_verification` | `controlRootRegistrationAccount(actorId, args.userId, 'resend', { confirmation: args.confirmation })` |
| `delete_root_unverified_registration` | `controlRootRegistrationAccount(actorId, args.userId, 'delete', { confirmation: args.confirmation })` |

No new Root keys or migration. Existing policy consumers are unchanged except
reuse by the directory and Root resend. Registry source is untouched.

## Verification and open evidence

Targeted Vitest covers private service/HTTP authorization, typed confirmations,
workspace scope, accepted-invitation protection, workspace guards, current Root
rechecks, eligibility SQL, bounded literal searches, token/mail reuse, audit
failure, safe transport errors, en/fr rendering, empty/missing states, typed
confirmation failure/pending/success and simple-hook compatibility. Shared dialog,
configuration, module navigation and invitation regressions are included.

Actual PostgreSQL transaction/FK/concurrency proof, browser theme/viewport checks,
SMTP submission/readback, MCP host registration/transport checks and production
verification remain open. No full-suite/build pass or full Root parity is claimed.

Final branch checks: 133 tests across 15 targeted Vitest files passed, including
`tests/raw-sql-void-guard.test.ts`; `npx tsc --noEmit -p .` passed from `rebuild/`.
`git diff --check` passed. Dependencies/client were reused as supplied.

Commit attempt blocked: `git add` could not create the external linked-worktree
metadata file `/Users/mouad/Documents/ChatGPT/MS Social Pilot/app/.git/worktrees/msp-rootreg/index.lock`
(`Operation not permitted`). Changes remain uncommitted on `codex/root-registration`;
no push was attempted.
