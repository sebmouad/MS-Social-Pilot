# 05. Content and copy

## 1. Voice

Plain, specific and calm. Say what happens, then what to do. Write for a busy social media manager, not an engineer. English and French are both required (contract §1, §6).

## 2. Rules

| Element | Rule | Example |
|---|---|---|
| Buttons | Verb + object, sentence case | "Schedule post", "Reconnect Facebook", "Delete from Facebook" |
| Page titles | A noun; no description line | "Posts", "Insights", "Inbox" |
| Empty state | What this is + why it is empty + one action | "No posts yet. Your scheduled and published posts appear here. [Create post]" |
| No match | Different from empty | "No posts match these filters. [Clear filters]" |
| Error | What happened + why + how to fix; pass a provider's refusal through as the reason | "Facebook refused the post: the image is larger than 8 MB. Choose a smaller image." |
| Confirmation | Title = the question; body = the consequence; Cancel is focused first | "Delete this post from Facebook?" / "It disappears from the Page and can't be restored." |
| Success | Repeat the verb; disappear on the next task | "Post scheduled for Oct 23, 09:00." |
| Numbers | Value first; caveats in ⓘ | "2,020 followers ⓘ" |
| Dates | Workspace time zone, locale format; the time zone name only in ⓘ or the scheduling popover | "Oct 23, 09:00" / "23 oct., 09:00" |

## 3. Banned words on customer screens → replacements

| Don't show | Show instead | Where the detail goes |
|---|---|---|
| stored / stored data / stored matches | (nothing) or "saved" | ⓘ "Based on data synced up to Oct 21" |
| UTC | (the workspace-zone time) | ⓘ period line |
| resource / target / destination id | channel, Page, ad account | — |
| platform hold / remote hold / held on the platform | "Facebook will publish it" | Advanced › Who sends |
| app-held | "Social Pilot will publish it" | Advanced |
| local enabled state | "in use in this workspace" | — |
| provenance / coverage 2 of 4 | (nothing on the card) | ⓘ "2 of 4 channels have data" |
| "Missing values are unknown, not zero" (repeated per card) | "—" for unknown values | ⓘ once per card |
| scopes, grants, ads_management, Graph, insight edges | "permission to manage ads" | Settings › Channels › Permissions |
| internal IDs (`preview_ad_eur`, post ids) | names | Root only |
| "Neutral preview", "Unsaved preview · no destination response is available yet" | "Preview" | — |

Root screens are exempt, but they still use clear sentences.

## 4. The ⓘ pattern (owner decision 2026-10-21)

Every customer-facing number that has any caveat gets one ⓘ (03 §2.8). Write the content as short labelled lines:

```
Followers
Latest follower count for each channel, added together.
Period: Sep 22 – Oct 21 (UTC)
Coverage: 2 of 4 channels have data
People who follow several channels may be counted more than once.
Synced Oct 21, 11:03 · Learn more
```

Never remove a disclosure the contract requires (coverage, partial, non-additive sums, currencies). **Move** it into the ⓘ. A partial result swaps ⓘ for ⚠ so it is visible without opening.

## 5. Catalogs (rebuild, not legacy)

- Customer copy lives in each module's Root-editable EN/FR catalog: `src/modules/<module>/copy.ts` or `customer-copy.ts`, read with `configOrDefault`. The legacy `messages/*.json` files do **not** apply to the rebuild.
- **New:** a `shell.copy` catalog (owned by a new `src/modules/shell/` or by `home`; decide in batch 1) for the frame: skip link, area names, Channels, All channels, Manage channels, Create, user menu, Filter, Clear all, pagination, table defaults, Popover close, InfoTip labels.
- **Area and tab names** come from module manifests and must be bilingual: add `title: { en, fr }` to manifests and `navTitle` for tabs. Today they are English-only.
- **French typography:** a non-breaking space (U+202F narrow, or U+00A0) before `: ; ? !` and inside `« »`; typographic apostrophe `’`.
- **Tests:** extend `tests/ui-copy-coverage.test.ts` to every module catalog and the shell. Add a test failing on banned words (section 3) in customer catalogs.

## 6. Key strings (EN / FR)

| Key | EN | FR |
|---|---|---|
| `area.home` | Home | Accueil |
| `area.content` | Content | Contenu |
| `area.inbox` | Inbox | Messages |
| `area.insights` | Insights | Statistiques |
| `area.tasks` | Tasks | Tâches |
| `area.agency` | Agency | Agence |
| `nav.create` | Create | Créer |
| `nav.channels` | Channels | Canaux |
| `nav.allChannels` | All channels | Tous les canaux |
| `nav.manageChannels` | Manage channels | Gérer les canaux |
| `filter.button` | Filter | Filtrer |
| `filter.clearAll` | Clear all | Tout effacer |
| `composer.schedule` | Schedule | Programmer |
| `composer.publishNow` | Publish now | Publier maintenant |
| `composer.addToQueue` | Add to queue | Ajouter à la file |
| `composer.saveDraft` | Save draft | Enregistrer le brouillon |
| `insights.vsPrevious` | vs previous period | vs période précédente |
| `info.about` | About {name} | À propos de {name} |
