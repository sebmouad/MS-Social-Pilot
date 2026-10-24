# Bluesky module

Installed at source (lane 45) in `PLATFORM_MODULES` and `PLATFORM_HOSTS`, **off by
default** (`platforms.bluesky.enabled`). Declared operations: connection, discovery and
text publishing only. Media, schedules, first comments, status, delete, inbox and
analytics are not declared and are absent from customer choices.

- `module.ts` manifest · `config.ts` Root keys (`platforms.bluesky.*`, `bluesky.policy`
  with endpoint, timeout, text bound and English/French form and failure copy).
- `client.ts` / `transport.ts`: AT Protocol `createSession` and `createRecord` over the
  Root-configured PDS only; redirects refused, sanitized errors, no retries.
- `connection.ts`: credential connection. The customer enters a handle and an **app
  password**; the module verifies it with a real session and returns the account (DID)
  as the single destination. The shared Settings service
  (`connectWithCredentials`) owns authorization, the exact
  `CONNECT WITH CREDENTIALS bluesky` confirmation, encrypted storage and audit.
- `adapter.ts`: text-only publishing. The stored credential (identifier plus app
  password) is module-encoded; a session is created per publish. A failure after the
  write was sent is classified `uncertain` and never resent automatically.

Live gates still open: a real app-password session and post, outcome verification and
cleanup, browser EN/FR/keyboard checks of the credential dialog, a Root decision to
enable. Remaining legacy parity: media, rich-text facets, link cards, remote delete,
counters and replies.

Local checks from `rebuild/`: `npx vitest run --config src/platforms/bluesky/vitest.config.ts`
(transport tests) and `npx vitest run tests/credential-connections.test.ts`.
