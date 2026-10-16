# Root diagnostics and connectivity batch

User request: add diagnostics and relevant tests, including API connectivity, within the approved Root ownership/menu structure.

Implemented and verified:

1. Derive scopes and product job ownership from installed manifests. Keep shared infrastructure separate from each product/platform screen, with controls in the existing sidebar/drawer.
2. Share current-Root-checked safe services across UI, HTTP and installation MCP. Reject workspace keys and arbitrary URLs/scripts. Confirm runs, record starts before probes, serialize scope-wide cooldown, and retain safe completed/unconfirmed history.
3. Add neutral infrastructure/configuration checks and Facebook-owned read-only identity, grant and discovery probes. Preserve credentials server-side. Bound suite execution and propagate provider cancellation; preserve each started run’s recovery floor across settings changes.
4. Correct worker health to use replacement-only history/identities and safe DTOs. Preserve previous dispatch priority through central Root `jobs.order`. Use explicit Root operational timezone to avoid server/browser hydration differences.
5. Verify service/UI/HTTP/MCP authorization, failures, timeouts, receipts and recovery, including eight PostgreSQL rollback probes, real synthetic-preview browser/API/MCP checks, independent static review, typecheck and isolated production build.

Evidence and limitations: [PREVIEW_QA.md](../../PREVIEW_QA.md), [DIAGNOSTICS.md](../../DIAGNOSTICS.md). This is one working batch, not completed rebuild or production/live-provider proof. No production deployment is included.
