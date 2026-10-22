# Root audit and remediation

Authenticated production inspection: `/root`, `/root/status`, `/root/config/email`, `/root/config/general`, `/root/platforms`, `/root/connections`. Source and isolated browser tests extend coverage to root configuration, mobile navigation, action handling and authorization.

## Fixed

- **P1 — partial configuration saves.** Root configuration previously wrote each setting before validating later values. A rejected batch could already change live settings. The shared settings writer now validates and encrypts the whole batch before a single database transaction. Regression tests cover earlier writes and clears remaining untouched after rejection; the root API has a regression as well.
- **P1 — lost configuration drafts.** Shared `useUnsavedChanges` protects internal links, supported history traversal and reload. Composer uses the same hook. Settings do not persist secrets in browser storage. Section/platform remount keys prevent draft spillover. Reverting visible values clears dirty state; blank secrets retain existing values.
- **P2 — concurrent root actions.** Immediate locks serialize saves and root table mutations. Configuration fields freeze while saving; environment adoption is disabled while drafts exist. Shared request outcomes distinguish unconfirmed transport/response failures; drafts remain available on failure.
- **P2 — inconsistent accessibility/navigation.** Root has a main-content skip link. Phone navigation closes after route changes. Configuration error/success messages use alert/status roles. Redundant single-group headings and the duplicate General group title are removed.
- **P2 — wrong setup instruction.** Overview operator/legal warning now points to General settings, matching navigation.

## Production setup findings

- App, database and worker report healthy. Platforms show twelve Meta channels and honest empty counts elsewhere. Root Connections loads its channel inventory.
- Operator saved as Anasso Traveaux; operator country saved as Morocco. Root account display name saved as Mouad Sebhaoui. Legal contact email sebmouad@gmail.com and governing-law wording "the law of Morocco" were saved on 14 October 2026. Root overview now shows no missing legal-details notice.
- Status reports no recorded off-site backup. Deployment backups succeeded locally on the server. Off-site backup readiness needs the chosen external storage and credentials, then a successful recorded backup and restore drill.
- Registry-generated setting labels, descriptions and hints remain English metadata even when interface chrome uses French. This is an existing localization debt outside the new paired EN/FR interaction strings. A follow-up should move registry display metadata to catalogs without translating keys, environment variables or provider identifiers.

## Verification

Full non-timeout suite: 1,852 tests passed across 187 files. Root settings/API rollback tests, final root browser regressions and Node 22 HTTP timeout checks are recorded in the delivery report. Production interaction was read-only; writes exercised isolated test data. Native Chrome accessibility trees verified page structure and controls; raster capture was unreliable, so this report does not claim complete pixel-level root review.

Shared owners and extension rules: `app/docs/INTERNAL_STANDARDISATION.md`. Final release and deployment health: `audit/remediation-delivery-2026-10-13.md`.
