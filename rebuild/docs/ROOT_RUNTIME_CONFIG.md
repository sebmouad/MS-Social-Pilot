# Root runtime configuration slice

The private `/root/config` screen is guarded by the existing installation owner flag (`User.isInstanceOwner`) and the validated legacy session cookie. Its API returns 404 to signed-in non-owners and never returns plaintext secrets.

`src/lib/config/registry.ts` is the only definition point for this first slice. Its Zod schema validates each submitted value. Ordinary values are stored in the existing `app_settings` table. Secret values use the installation `ENCRYPTION_KEY` with AES-256-GCM and the same `v1:<iv>:<tag>:<ciphertext>` envelope used by the legacy app. Root changes append a `config.changed` record to the existing `root_activities` audit table; audit details contain only the key and change type.

The current registry contains Meta Graph API version, Meta app secret, background jobs enabled, and support email. The rebuild does not yet consume most of these settings, and the UI describes that limitation. Module and feature entries are generated from `src/lib/product.ts`; the current availability section is a catalog preview only. Persisting or enforcing availability switches requires integration with the rebuild access layer and is intentionally not implied here.

This slice does not configure `DATABASE_URL`, `ENCRYPTION_KEY`, or session authentication. It does not include all legacy runtime settings. Adding a field requires an explicit registry definition and, when runtime behavior should change, a consumer that reads the validated value.
