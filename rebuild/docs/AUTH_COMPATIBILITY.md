# Legacy authentication compatibility

The fresh app can validate an existing account without copying the legacy
interface, preferences, or settings. `src/server/auth.ts` contains pure,
read-only helpers for the current production password and session formats.
The caller must read the legacy records and must not pass them into a write
path.

## Existing formats

- Password hashes use `scrypt:16384:<base64url salt>:<base64url digest>`.
  The salt is 16 bytes and the digest is 64 bytes. Verification is limited to
  this exact cost and shape to reject malformed values without accepting
  attacker-controlled scrypt parameters.
- The browser cookie is named `msp_session`. Its value is a 32-byte random
  token encoded as unpadded base64url. The `sessions.tokenHash` value is the
  lowercase hexadecimal SHA-256 digest of that cookie value.
- A session is valid only when it is unexpired, not pending a second factor,
  and belongs to a user whose `disabledAt` is null. Membership and role checks
  remain separate authorization steps after authentication.

## Minimum records and Prisma compatibility

To verify passwords against the existing production database, a read-only
query needs `User.id`, `User.email`, `User.passwordHash`, and
`User.disabledAt`. Email lookup should normalize the submitted address the
same way as the legacy app (`trim().toLowerCase()`).

To validate existing sessions, a read-only lookup needs
`Session.id`, `Session.userId`, `Session.tokenHash`, `Session.expiresAt`,
`Session.pending`, plus the related `User.id` and `User.disabledAt`. The
existing unique index on `Session.tokenHash` is expected. The helper accepts
the session and user fields explicitly so the new Prisma schema can choose
whether to map these fields to the original tables or expose a separate
read-only legacy client.

No schema migration is required by this helper. If the fresh app uses a
different database, the bridge needs a separately configured read-only
connection to the production database; data should not be copied merely to
make authentication work. If production records are moved, preserve user IDs,
password hash strings, session IDs, token hashes, expiration times, pending
state, and disabled state exactly. Never export raw session cookie tokens.

## Session and account migration gaps

- Existing browser sessions work only if the new app receives the same cookie
  value and can query the matching session row. A different hostname, cookie
  name, or isolated session store requires users to sign in again.
- Pending sessions represent an unfinished second-factor flow and are rejected
  by the normal-session validator. The rebuild creates new pending sessions
  after password verification and can complete TOTP, recovery-code, or TOTP
  enrollment flows. Existing legacy pending challenges should be restarted
  with a fresh password sign-in. Passkey verification remains unimplemented.
- Password verification is compatible, but new password hashing and any
  rehash-on-login migration policy are outside this bridge. Do not overwrite
  legacy hashes until the fresh app's password policy and storage are settled.
- Authentication alone grants no workspace access. The new app must load
  current memberships and enforce its own authorization rules for every
  workspace operation. This bridge does not import settings, themes, roles,
  memberships, or application data.
- Email verification, account recovery, trusted devices, and passkeys are not
  implemented in this bridge. TOTP enrollment is implemented by the rebuild's
  separate two-step service, using the existing user and recovery-code tables.

The helpers in this document perform no database reads or writes themselves.
Their rebuild callers now write sessions and two-step credentials. Keep a
tested rollback path and fail closed when required fields are unavailable.
