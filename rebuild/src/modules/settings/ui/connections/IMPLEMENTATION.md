# Connection workflow status

Facebook connection uses a same-origin start request and an OAuth callback. The short-lived, encrypted state cookie binds the callback to the initiating user and workspace; its expiry comes from Root configuration. The callback rechecks the owner/admin membership, exchanges the code for a long-lived token, discovers Pages and ad accounts on the server, encrypts the user and Page tokens at rest, and writes the records with an audit event. Token values and provider error details are never returned to the browser. Newly discovered channels and ad accounts remain disabled until an owner or admin saves the checkbox selection.

Selection changes are submitted together after explicit confirmation. The API rechecks the current workspace membership and source ownership, applies updates in one transaction, and writes selection audit events in that transaction.

Local disconnect disables the source's channels and ad accounts, marks the source unavailable locally, and retains its records and history. Provider authorization is not revoked; remote-scheduled posts are left intact and may still publish at the provider.

Delete mode is exposed after a read-only count preview and typed confirmation. It removes mapped source, channel, ad-account, insight, inbox, comment, and destination-link rows in one transaction, retaining posts that still point to another channel and removing posts left without destinations. It is blocked when provider-scheduled destinations remain. Preview totals are estimates and omit dependent rows in legacy tables outside the rebuild compatibility schema; the schema is not a complete database erasure inventory. Neither preview nor deletion revokes provider authorization, deletes remote content, or handles export files in storage.
