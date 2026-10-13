---
name: add-network-connector
description: Add a new social network (e.g. YouTube, TikTok, Google Business Profile) to MS Social Pilot's publishing, following the existing connector framework.
---

# Add a network connector

Framework: `src/lib/networks/` (`types.ts` contract, `index.ts` registry,
`connect.ts` OAuth/connect, one file per network), rules in
`src/lib/network-rules.ts`.

1. Schema: add the key to `enum TargetType` (migration via `db-migration`).
2. Rules: add to `NETWORK_RULES` (text limit, images, video, needsMedia, linkCard).
3. Connector file: `publish(target, post, { credentials, saveCredentials })` using
   `netJson` (maps HTTP status → failure kinds; `untrustedHost` for user-given
   hosts); refresh tokens before use and persist with `saveCredentials` first.
4. Connect: OAuth branch in `startNetworkAuth`/`finishNetworkAuth`
   (`connect.ts`), PKCE if supported, state in the encrypted cookie; targets
   returned = the destinations (accounts, pages, boards, channels).
5. Settings: client id/secret in `src/lib/settings/definitions.ts` (group
   `networks`) + getters in `src/lib/env.ts` + `networkAvailable()`; list the env
   vars in the settings block of `docs/OPERATIONS.md` (not in `.env.example`).
6. UI: card text in `messages/*.json → networks.hint_<key>`, label in
   `targets.<key>` and `pagesSidebar.type.<key>`, mark in `NetworkMark.tsx`.
7. Tests: unit (text transforms, request shapes with stubbed fetch) +
   integration (save account, rule refusal, scheduler publish) like
   `tests/networks*.test.ts`.
8. Live: the owner creates the developer app and connects; first post only with
   their OK.
