# Platform access policy batch — 2026-10-17

This implements the approved module/configuration contract without changing the
target or enabling another provider. Facebook remains included by default.

## Required behavior

- Installed module declarations own access-policy keys and defaults; shared
  entitlement code never names a provider or blindly grants unknown plan IDs.
- Root separately controls installation enablement, inclusion for workspaces
  without a matching plan grant, and the existing plan feature keys that grant
  access. All are module-owned validated/audited registry settings.
- Suspended customer workspaces cannot gain platform capabilities. Existing
  private installation inspection behavior remains separate from bearer access.
- Invalid/encrypted policy values fail closed, without silently restoring a
  permissive default. Missing values use registered validated defaults.
- Connection choices, OAuth start/callback, resource selection and customer
  resource reads/actions apply current workspace platform access. Root still
  inspects/configures installed modules independently of workspace entitlement.
- Denied/disabled resources stay stored. This changes availability, not retention
  or a claim that a provider credential was revoked remotely.

## Implementation and verification sequence

1. Reproduce unknown-plan grants, hardcoded default and missing connection
   entitlement enforcement with targeted regressions.
2. Add typed manifest keys and Facebook-owned Root access entries. Build neutral
   policy resolution from installed manifests and validated settings.
3. Load the current policies with existing entitlement reads; gate connection
   start/callback and selection. Filter normal connection/MCP choices with the
   caller's current entitlement. Review Inbox/Ads selected-resource boundaries
   independently using lower-cost agent with disjoint file ownership.
4. Run targeted/full tests, typecheck/build, real local MCP/API and browser
   checks against disposable/synthetic preview state. Restore any preview
   configuration after tests and verify cleanup.
5. Review current diff, document exact evidence/remaining gaps, commit and push
   main. Do not deploy legacy or bypass full production cutover gates.

## Implemented evidence and remaining boundaries

Implemented in registry 46. Regression-first fixes cover unknown-plan provider
grants, suspended workspace defaults, Root enablement, missing OAuth entitlement,
resource selection and raw HTTP exception matching. Neutral policy tests cover
additional example providers, configured plan keys/default inclusion, missing
definitions and invalid/encrypted values. Shared Inbox/Ads changes were built
independently by a lower-cost agent with disjoint source ownership.

The isolated preview probe uses synthetic seed data and temporary access. It
changes Facebook default inclusion and plan-grant policy through actual private
Root MCP, proves consistent customer HTTP/MCP filtering/denial without provider
requests, suspends/restores the preview workspace through Root and proves that
an instance owner cannot start customer OAuth while suspended. Root remains
available. It restores original policy rows and verifies resource visibility;
temporary keys/sessions are removed. An injected restore-request failure proved
the direct exact snapshot fallback and expected failing diagnostic result.

The module's provider-owned background collectors still use installation
enablement/connection rules rather than a completed workspace subscription/job
policy. Full plans/billing administration, per-module operations, all resource
and interface combinations, live provider behavior and cutover remain open.
Do not label this batch complete modularization or production readiness.
