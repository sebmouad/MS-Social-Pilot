# Round 12: three client-sharing gaps

This batch closes three narrower workflow gaps, not three entire inventory rows:
confirmed title/description edits, inherited workspace logo display, and notices
for advisory client decisions. The full sharing inventory remains partial.

Every link edit now requires `UPDATE SHARE LINK <id>` at the shared service.
The UI asks for acknowledgement for metadata edits as well as access edits;
metadata preserves the address. Stale versions remain conflicts. UI, PATCH and
`update_share_link` enter the same scoped, audited transaction.

`sharing.presentationPolicy` is the new typed Root key. It declares
`showWorkspaceLogo` (true), `logoUrlMaxCharacters` (2048), and
`advisoryDecisionNotificationsEnabled` (true). The schema version is intentionally
unchanged for the integrator. The existing workspace `logoUrl` is projected only
as a bounded HTTPS URL without credentials, after public link authorization.
Disabled/invalid URLs disappear while workspace identity remains. Images have an
empty decorative alt next to the name, bounded layout and no-referrer policy.
The authorized owner list, GET route and `list_share_links` expose the same safe
presentation metadata. This does not add a workspace logo editor or proxy images.

Advisory approvals and change requests enqueue `approval_decision` events in the
same transaction as the answer and audit, using the answer id as event identity.
The existing notification service checks author identity, current feature,
resource/tenant visibility and personal email preferences. It supplies existing
Root-editable EN/FR notification copy and delivery/retry behavior. Actual applied
answers already enqueue through Publishing; this lane does not duplicate them.
Comments remain in Feedback without a notification. Queue failure rolls back the
transaction and returns an unconfirmed answer. Mocked transaction callbacks do
not prove PostgreSQL rollback or SMTP delivery.

No routes, migrations, worker registration, schema-version changes, servers,
commits, pushes or production actions are included. Module-owned config is already
aggregated through Settings. The public decision route remains a reviewed
share-token authority exception to workspace MCP; authenticated feedback and
notification reads keep their existing mapped services.

Remaining: portal results, automatic publish-anyway, logo editing, client-link
invitation email, distributed public throttling, current browser/theme/phone
checks, PostgreSQL concurrency and real REST/MCP/email-client outcomes. The
integrator should update ARCHITECTURE.md, GOAL.md and AGENT_HANDOFF.md and bump
CONFIG_SCHEMA_VERSION; these files are outside this worker's owned paths.
