---
name: no-hardcoded-settings
description: "Never hardcode variables, options, origins or settings (incl. env defaults in deploy scripts); everything must be Root-UI controlled"
metadata:
  node_type: memory
  type: feedback
  originSessionId: d16b3cd0-991c-4f7e-adce-456d9a84beea
  modified: 2026-10-20T20:41:10.186Z
---

Never hardcode variables, options or settings anywhere: app code, deploy scripts or env files. Every operational value (public origin, URLs, limits, labels) must be a typed Root config entry editable from the UI.

**Why:** User (2026-10-20) rejected a `PUBLIC_ORIGIN` env value with a hardcoded default in a deploy script: "i need to have full control from UI".

**How to apply:** Add a registry entry (module `config.ts` or `shared-config.ts`, bump CONFIG_SCHEMA_VERSION) and read it via runtimeConfig; set production values through the audited saveConfig path, never baked into scripts. Only bootstrap secrets (DATABASE_URL, ENCRYPTION_KEY, SESSION_SECRET) stay in env, per the contract.
