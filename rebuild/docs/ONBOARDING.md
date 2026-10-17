# Workspace invitation and onboarding

## Current contract

Workspace invitations live in the existing legacy `invitations` table through
bound compatibility SQL; this feature adds no Prisma table or DDL. Settings
owners and admins can invite existing or new accounts as contributor, editor,
or admin. Admins cannot invite owners; assigning owner remains a protected
Root-level operation. Listing and revocation are workspace-scoped, confirmed,
audited operations shared by the Settings UI, HTTP, and workspace MCP. Reissue
requires explicit confirmation and replaces the old token; accepted invitations
cannot be revoked or replayed.

Root configuration version 57 adds the default-off invitation switch, invitation
lifetime, per-workspace pending ceiling, directory page ceiling, and encrypted
preview-cookie lifetime. Shared transactional mail is independently default-off.
Availability requires invitations enabled, complete mail configuration, and a
valid public origin. Turning invitations off blocks preview, acceptance,
registration, and creation; listing and revocation remain available. Existing
pending links therefore stop working while the switch is off.

Tokens contain 32 random bytes, encoded as canonical 43-character base64url;
only a SHA-256 hash is stored. Email links place the raw token in the URL
fragment (`/join#…`), never in the request URL/query. Preview exchanges it for
an encrypted, HttpOnly, SameSite=Strict continuation cookie bounded by the Root
session-minute setting. Token material is not returned in APIs or MCP and is
excluded from application logs and audit details. Delivery receipts contain
only the delivery classification, never the message body or token.

Existing-account acceptance requires a fully verified, active session and an
exact email match. Privileged invitations also require the current Root
two-step enrollment policy to be satisfied before membership changes. New
account registration refuses every existing account, enforces the shared
password policy, and atomically creates the account, workspace membership,
accepted invitation state, and domain audit. It creates no session; the user
continues through normal sign-in and MFA. The invitation proves mailbox
possession and marks the new account email verified. Neither path creates an
instance owner or an automatic personal workspace.

Membership scope starts least-privileged: ordinary roles receive no channel
grants (`allPages=false`); owner/admin memberships receive all channels. The
customer must communicate this access effect before confirmation. Each use
rechecks the current inviter's active membership, role, permission, team feature,
and entitlement; creation and each acceptance/registration recheck current
workspace constraints. Transactions serialize against team mutations using
the same workspace lock and bounded transaction settings. Inviter authority
is checked again when the recipient accepts, so a stale invitation cannot
preserve authority the inviter has lost.

Invitation rows and acceptance/audit state commit before SMTP dispatch. A known
send failure is reported as failed; ambiguous SMTP outcomes are `uncertain` and
are not retried automatically. The operator/user must explicitly reissue, which
invalidates the prior link. If recording the delivery receipt fails after SMTP
returns, the result is also `uncertain`; it must not falsely claim mail failure.
The legacy email log may show `failed` with a `delivery_unconfirmed` marker for
this receipt-loss case. No email body, token, SMTP password, or raw transport
error is logged.

## Scope still missing

This delivers workspace invitations and registration only. General-purpose
email verification/resend, password recovery, OAuth login, broader public
onboarding/account-scope APIs, and seat-plan policy remain unimplemented.
Management MCP parity is covered; public invitation preview/accept/register is
not exposed through workspace MCP. Full clean-phone browser flow and a fresh
browser visual pass have not been verified. Production remains on the legacy
application; no production migration or deployment is implied.
