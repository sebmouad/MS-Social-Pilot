# Connection workflow status

Facebook connection uses a same-origin start request and an OAuth callback. The short-lived, encrypted state cookie binds the callback to the initiating user and workspace; its expiry comes from Root configuration. The callback rechecks the owner/admin membership, exchanges the code for a long-lived token, discovers Pages and ad accounts on the server, encrypts the user and Page tokens at rest, and writes the records with an audit event. Token values and provider error details are never returned to the browser. Newly discovered channels and ad accounts remain disabled until an owner or admin saves the checkbox selection.

Selection changes are submitted together after explicit confirmation. The API rechecks the current workspace membership and source ownership, applies updates in one transaction, and writes selection audit events in that transaction.

Local disconnect disables the source's channels and ad accounts, marks the source unavailable locally, and retains its records and history. Provider authorization is not revoked; remote-scheduled posts are left intact and may still publish at the provider.

Permanent deletion is not exposed. This rebuild schema is a partial compatibility view, so it cannot prove that every legacy relation pointing at a source has been enumerated. A safe delete flow needs a complete relation inventory and a count preview before deleting any associated records.
