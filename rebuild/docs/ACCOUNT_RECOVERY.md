# Account password recovery

Password recovery reuses the legacy `email_tokens` table (`purpose = 'reset'`) and `sessions` table. It adds no schema change. The service stores only a SHA-256 token hash, replaces earlier outstanding reset links, and consumes a token under row locks in the same transaction as the password update, session revocation, and `root_activities` audit record. A concurrent or repeated reset cannot reuse the token.

The public request endpoint responds with the same receipt for unknown, disabled, and active accounts. Its work runs after the response to avoid disclosing account existence through SMTP latency. It sends the recovery token in the URL fragment; the browser removes the fragment before rendering the password form and sends the token only in the JSON reset request body. The URL fragment is not included in HTTP requests or referrers.

Successful reset writes a legacy-compatible scrypt password hash, records the email as proven (matching legacy behavior), revokes every existing browser session, and requires a fresh sign-in. It neither issues a session nor clears TOTP, passkeys, or recovery factors, so normal MFA policy remains in force. Unexpected database and mail errors are masked; the mail layer owns safe delivery metadata logging.

`auth.passwordRecoveryTtlMinutes` is the Root-managed, validated link lifetime (default 60 minutes, bounded to 5–1440). The host must include `ACCOUNT_RECOVERY_CONFIG` in the typed Root registry. The recovery endpoints use `sendTransactionalMail` and `publicMailOrigin`, so the Root mail settings and encryption bootstrap must be wired and configured for delivery.

There is deliberately no MCP recovery operation: the current MCP identity is scoped to an authenticated workspace or installation, while password recovery is an unauthenticated self-service account flow. Returning a token or dispatching email from MCP would create an account-scope capability without a safe identity/consent contract. Workspace and installation MCP can continue to support their authenticated account management functions.
