# Shared delivery plan

Updated 2026-10-21 against local HEAD `8852d367`. Goal remains active:
[GOAL.md](GOAL.md). Binding target: [ARCHITECTURE_CONTRACT.md](ARCHITECTURE_CONTRACT.md).
Current implementation: [ARCHITECTURE.md](ARCHITECTURE.md).

## Position

Production cutover occurred 2026-10-20; the rebuild serves social.newsgeet.com,
legacy web/worker are recorded disabled and rebuild releases use
`rebuild/scripts/prod-deploy.sh`. The legacy command is guarded. Follow-up work
must preserve the single publisher and existing rollback assets. The results log
in RELEASE_GATES_PLAN.md is evidence; its original pre-cutover plan is historical.
No claim that all contract gates passed follows from the deployment.

Recent integrated source includes the four light/dark theme palettes and shared
components/charts, Home REST/MCP, AI providers, per-destination scheduling,
expanded Analytics/Ads/Settings surfaces, key-authenticated Analytics/Ads REST v1,
Facebook post history/hierarchy collection, WordPress recipes, and UI refinements
for Publishing, Inbox, Tasks, Agency, Reports and Settings. Consult lane documents
for actual evidence; older branch-only/migration-unapplied statements are snapshots,
not a substitute for checking current source and the target database.

## Next reviewable batches

| Order | Work | Required evidence / owner |
| --- | --- | --- |
| 1 | Reconcile current release/migrations and remaining operational checks | Release owner verifies deployed SHA, migration history/ownership, restorable backup/media and post-cutover rollback. Do not replay cutover or assume new pinned files applied |
| 2 | Finish service/transport parity | Inbox owner adds REST bulk entry to `bulkInboxAction`; Settings owner unifies single/batch selection and disconnect confirmations; Sharing/Agency owners review confirmation differences. Preserve credential ceilings |
| 3 | Finish appearance and configuration consumers | Shell/Settings owner routes global theme changes through appearance service and reads account theme when cookie absent. Integrations owner fixes inactive metadata and remaining request/UI caps. Module owners extract remaining copy/policy per CONFIG_LITERAL_AUDIT |
| 4 | Verify per-destination scheduling | Publishing/Facebook owners exercise migration, mixed app/native holding, queue, approval, cancel/reschedule, first comments and worker exactly-once outcomes on PostgreSQL/browser/provider. Review hand-off coupling to mix/recycle and oldest-first fairness |
| 5 | Verify recipe automation before enabling | Feeds owner rehearses migration/export/erasure, read-only MariaDB mapping, image storage, dry-run slot allocation, confirmations/scope, uncertain claims, approval and first-comment outcomes. Enable only after scoped live verification/cleanup |
| 6 | Complete Facebook data coverage | Adapter owner verifies eligible current metrics and saved Root overrides; checks history completion against actual Page inventory, tenant cursor migration and Ads hierarchy/breakdowns. Extend conversation metadata through neutral persistence contracts |
| 7 | Complete browser and language coverage | UI owners run current eight-palette desktop/phone, keyboard, failure and recovery checks with synthetic examples. Cover recent Inbox, Publishing, Reports, Tasks, Agency, Settings, Root and public changes; prior-theme matrices do not cover new palettes |
| 8 | Close remaining legacy/provider and recovery gaps | Per-module evidence in LEGACY_CAPABILITY_PARITY; live Facebook/MCP reads/writes/cleanup, real mail/security/export/erasure/scale, complete Root controls, provider-native formats and other required connector decisions remain explicit |

Steps needing a database, browser/server, provider or production access belong
to an authorized integration session, not this documentation worker. No whole
suite was requested for this lane. Keep targeted test results, browser evidence,
remote provider outcomes and production evidence separate.

## Known open details

- Latest contact-details REST is implemented (`8852d367`); Inbox bulk REST remains
  absent. Do not reopen the already delegated OAuth compatibility route: it now
  calls `connectionStartHttp`. Batch selection REST/UI now call the confirmed
  `changeConnectionSelections`; the single MCP path still calls the lower core.
- Analytics/Ads `/api/v1/<module>/<operation>` dispatches the owning MCP groups
  through the authenticated host, retaining key scope and confirmations. This is
  source/unit evidence, not a real key/client/provider pass for every operation.
- Root registration tools and disconnect-with-delete are integrated; Agency
  overview person credentials exist. Older notes saying they are missing are
  superseded. Person keys remain read-only overview-only; session Clients and
  workspace switching do not expand those credentials.
- Config schema version is 104 in local source. This documentation batch adds no
  keys. Reconcile future lane keys centrally; do not bump for prose changes.
- Native formats remain subject to module switches/proofs and live eligibility.
  Preserve held-photo cleanup ledger/lock; unreadable remote IDs are not deletion
  evidence. Do not blindly resend an uncertain publication/comment/deletion.
- Last recorded operational gaps include mail configuration/live delivery,
  post-cutover rollback drill, Inbox provider calls holding long transactions
  and worker shutdown exceeding systemd timeout. Revalidate before fixing; this
  worker did not observe current runtime behavior.

## Delivery discipline

Use independently owned reviewable batches; product logic stays in modules,
Facebook rules in its platform, shared hosts neutral. Shared services own current
auth/scope, exact confirmations and audits for every entry point. Keep the contract
unchanged unless the owner makes an explicit architecture decision. Update this
plan, architecture and handoff with behavior/evidence changes. Publication follows
the active lane authorization; this worker must not push, deploy or touch production.
