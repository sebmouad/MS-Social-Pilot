# Connection workflow status

Facebook connection uses a same-origin start request and an OAuth callback. The short-lived, encrypted state cookie binds the callback to the initiating user and workspace; its expiry comes from Root configuration. The callback rechecks the owner/admin membership, exchanges the code for a long-lived token, discovers Pages and ad accounts on the server, encrypts the user and Page tokens at rest, and writes the records with an audit event. Token values and provider error details are never returned to the browser. Newly discovered channels and ad accounts remain disabled until an owner or admin saves the checkbox selection.

Selection changes are submitted together after explicit confirmation. The API rechecks the current workspace membership and source ownership, applies updates in one transaction, and writes selection audit events in that transaction.

Local disconnect disables the source's channels and ad accounts, marks the source unavailable locally, and retains its records and history. Provider authorization is not revoked; remote-scheduled posts are left intact and may still publish at the provider.

Delete mode is exposed after a read-only count preview and typed confirmation. It removes mapped source, channel, ad-account, insight, inbox, comment, and destination-link rows in one transaction, retaining posts that still point to another channel and removing posts left without destinations. It is blocked when provider-scheduled destinations remain. Preview totals are estimates and omit dependent rows in legacy tables outside the rebuild compatibility schema; the schema is not a complete database erasure inventory. Neither preview nor deletion revokes provider authorization, deletes remote content, or handles export files in storage.

## Shared UI adoption (Settings lane, 2026-10-20)

Social sources are displayed as shared DataTables grouped by the installed platform's safe display name. Initials identify an account without inventing an avatar photograph. Shared status Badges retain token expiry, grant-health and unknown-access explanations. Each source has a row Menu for reconnecting through the canonical OAuth service, selecting resources and starting a local disconnect. Reconnect is an authorization flow; this UI does not claim a background token refresh.

The old `/api/connections/[platform]/start` entry point now delegates to `connectionStartHttp`, just like canonical OAuth REST. It requires the same signed-in session, current service authorization and exact `START CONNECTION <platform>` confirmation. The compatibility route no longer bypasses that service.

Selection PATCH now calls `changeConnectionSelections`, the same confirmed/configured application service used by MCP. The UI submits `SET CONNECTION SELECTIONS <changed count>`; unchanged selections cause no write. The service's Root-managed batch limit applies; its existing transaction-level mutation remains authoritative. After success, the router refreshes server data without clearing the shell's toast. Disconnect retains the preview, retain/delete choice, typed DELETE and scheduled-publication guard, then opens a named ConfirmDialog. Failures keep the final dialog open.

Evidence: targeted unit/DOM tests only. No browser, database, real-provider or production verification in this batch. The Settings lane handoff is `../IMPLEMENTATION.md`.
