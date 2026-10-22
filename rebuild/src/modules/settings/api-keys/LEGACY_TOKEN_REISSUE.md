# Legacy API token reissue

Decision for this lane: **reissue; do not import `api_tokens` into person keys**.
No legacy token, hash or scope was changed, and no database script was run.

Legacy `src/lib/api-tokens.ts` ties every `msp_` credential to its original user
and workspace. Its `read`/`write` ceiling intersects that person's current role,
channel access, enabled modules and developer-feature policy on every call.
`api_tokens.tokenHash` is a one-way SHA-256 digest; it cannot yield a replacement
secret. New keys have different protocol prefixes and explicit feature/resource
ceilings. Copying hashes does not implement compatible authentication.

Person keys (`settings/person-keys/service.ts`) are read-only `agency/overview`
credentials spanning **all currently eligible administered workspaces**, including
future ones. They are not a replacement for a one-workspace API token. Never
copy a legacy workspace key into `person_mcp_keys`, grant it a person identity,
or treat the old `write` string as installation-owner authority.

## Reissue procedure

1. Inventory safe metadata from `api_tokens` in the authorized migration
   environment: `id`, `workspaceId`, `userId`, `name`, `scope`, `prefix`,
   `createdAt`, `lastUsedAt`, `revokedAt`. Filter to the intended workspace and
   user; never select `tokenHash` or print customer records into build logs.
   Keep revoked keys revoked and ignore accounts with no current membership.
2. The **same original user** signs in, selects the **same workspace**, and opens
   `/settings/mcp`. The shared replacement service is
   `modules/settings/mcp-access/server.ts::issueMcpKey`; its session REST entry is
   `POST /api/settings/mcp-keys`. It rechecks current authority and audits issuance.
   The current replacement issuer permits owners/admins only. For legacy
   member/viewer token holders this is a remaining compatibility restriction:
   use session access or have the integrator implement same-person issuance
   under an explicit policy. Do not promote a user or issue as another person
   and claim identical authority.
3. Select only feature reads used by that integration. A legacy **read** key gets
   `writeFeatures: []`. A legacy **write** key may receive only the corresponding
   writes that this person is currently authorized to perform, each also present
   in `readFeatures`. Never select Root, account/session-only or Agency person
   features. Confirm with the service's exact `CREATE MCP KEY <trimmed name>`.
4. Use an explicit resource ceiling:
   `{version: 1, mode: 'selected', ids: [...], adAccountIds: [...]}`. List only the
   original workspace's currently selected, accessible resources. Channels and
   ad accounts are independent ceilings. An empty selection grants no resources.
   `mode: 'all'` is appropriate only after separately confirming the original
   all-channel authority and intended future-resource access. Choose a lifetime
   within current Root policy; the legacy absence of expiry must not become an
   unlimited new key.
5. Copy the newly returned secret once into the integration's secret store.
   Update its endpoint/protocol for the rebuild's implemented REST/MCP tools.
   The new `mcp_` secret is not an alias for the old `msp_` token. Do not put it
   into a URL, SQL migration, issue, screenshot or report.
6. Verify an allowed read, wrong-workspace/resource refusal, write refusal for a
   read key, and permission removal/demotion refusal using the real client.
   Verified writes require their exact confirmation and subsequent audit/remote
   checks. Mocked service tests do not establish a migrated integration works.
7. Only after those checks, retire the old credential using the legacy revocation
   workflow or an explicitly authorized, scoped migration operation. Retain its
   metadata and the `api_tokens` table until the cutover/backup owner approves
   cleanup. Never keep two publishers against the same queue.

## Limites et procédure en français

Les anciennes clés restent liées à leur utilisateur et à leur espace d’origine.
Elles ne sont pas converties en clés personnelles Agence, qui couvrent plusieurs
espaces. Connectez-vous avec le même compte, sélectionnez le même espace puis
ouvrez **Paramètres → Accès MCP** (`/settings/mcp`). Choisissez uniquement les
fonctions et les ressources nécessaires. Pour une ancienne clé en lecture seule,
ne cochez aucune écriture. Copiez le nouveau secret une seule fois et mettez à
jour votre intégration. Vérifiez les accès autorisés et les refus avant de
révoquer l’ancienne clé. Si votre rôle ne permet pas de créer une clé, conservez
l’accès par session et demandez une solution à l’administrateur ; ne changez pas
de compte ou de rôle pour contourner cette limite.

This is a documented reissue path, not evidence that legacy clients or data have
been migrated. No additional Root key, route or capability is introduced here.
