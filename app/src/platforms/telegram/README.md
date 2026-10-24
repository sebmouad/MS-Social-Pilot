# Telegram module

Installed at source (lane 45) in `PLATFORM_MODULES` and `PLATFORM_HOSTS`, **off by
default** (`platforms.telegram.enabled`). Declared operations: connection, discovery and
text publishing to one channel. Media, schedules, status, delete, inbox and analytics
are not declared.

- `module.ts` manifest · `config.ts` Root keys (`platforms.telegram.*`, `telegram.policy`
  with Bot API endpoint, timeout, text bound and English/French form and failure copy).
- `client.ts` / `transport.ts`: Bot API `getMe`, `getChat`, `getChatMember`, `sendMessage`;
  redirects refused, sanitized errors, no retries.
- `connection.ts`: credential connection. The customer enters a **bot token** and the
  channel (`@name` or `-100…`); the module verifies the bot is an administrator able to
  post and returns the channel as the single destination. The shared Settings service
  (`connectWithCredentials`) owns authorization, the exact
  `CONNECT WITH CREDENTIALS telegram` confirmation, encrypted storage and audit.
- `adapter.ts`: text-only messages to the stored channel. A failure after sending began
  is `uncertain` and never resent automatically.

Live gates still open: a real bot and channel connect and post, outcome verification and
cleanup, browser EN/FR/keyboard checks of the credential dialog, a Root decision to
enable.

Local checks from `rebuild/`: `npx vitest run --config src/platforms/bluesky/vitest.config.ts`
(transport tests for both credential providers) and `npx vitest run tests/credential-connections.test.ts`.
