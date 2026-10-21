# 06. Accessibility, local preview and QA

## 1. Accessibility requirements (WCAG 2.2 AA, contract §6)

| Area | Requirement |
|---|---|
| Contrast | Text ≥4.5:1 (large ≥3:1); UI boundaries, icons, focus, chart marks ≥3:1. All 8 palettes **and system mode** in tests. |
| Keyboard | Everything reachable; visible 2 px focus; roving tabindex in sidebar lists, tabs, menus; Escape closes the top layer and returns focus. |
| Landmarks | `nav` (sidebar, aria-label "Main"), `header` (TopBar), `main#main-content`, `nav` (BottomBar, "Quick navigation"); one `h1` per page. |
| Names | Icon buttons have `aria-label`; avatar chips `aria-pressed` with channel name; ⓘ "About <name>". |
| Live regions | Toasts `role=status`; errors `role=alert`; table loading `aria-busy`; filter result counts announced politely ("12 posts"). |
| Motion | `prefers-reduced-motion` disables transforms. |
| Forced colors | Borders `CanvasText`, active `Highlight` (keep existing rules). |
| Targets | ≥24 px always; 44 px under coarse pointer / ≤760 px. |
| Language | `<html lang>` follows the user's locale; mixed-language strings get `lang`. |
| Time | No timeouts on forms; toasts with actions stay until dismissed. |

## 2. Local preview (synthetic data only)

Recipe verified in the cloud container on 2026-10-21. Uses PostgreSQL 16 on localhost and the repo's seeders. Never use production data.

```sh
# 0. dependencies (repo root and rebuild)
npm ci && (cd rebuild && npm ci)

# 1. database (cloud container: start cluster, set a local password, create a *_preview DB)
pg_ctlcluster 16 main start
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\" -c 'CREATE DATABASE social_pilot_rebuild_preview;'"
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/social_pilot_rebuild_preview

# 2. schema: legacy schema, then every rebuild migration ("already exists" errors are expected)
cd rebuild && ../node_modules/.bin/prisma db push --schema ../prisma/schema.prisma --skip-generate
for d in $(ls ../prisma/migrations | grep rebuild); do psql "$DATABASE_URL" -q -f ../prisma/migrations/$d/migration.sql; done

# 3. private env file OUTSIDE the repo (scratch dir), then seed
cat > /path/outside/repo/preview.env <<EOF
DATABASE_URL=$DATABASE_URL
NODE_ENV=development
ENCRYPTION_KEY=$(head -c 32 /dev/urandom | base64)
PREVIEW_SEED_CONFIRM=SEED_LOCAL_REBUILD_PREVIEW
PREVIEW_QA_EMAIL=preview-qa@example.test
PREVIEW_QA_PASSWORD=<a local password of 12+ characters>
PREVIEW_MEDIA_ROOT=/path/outside/repo/media
EOF
node --env-file=/path/outside/repo/preview.env --import tsx scripts/seed-preview.ts
node --env-file=/path/outside/repo/preview.env --import tsx scripts/seed-inbox-history-preview.ts

# 4. run (use http://localhost:3200, not 127.0.0.1, for same-origin writes)
node --env-file=/path/outside/repo/preview.env ./node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3200

# 5. screenshots (design review)
PREVIEW_QA_EMAIL=preview-qa@example.test PREVIEW_QA_PASSWORD=... \
  node scripts/preview-screenshots.cjs /path/outside/repo/shots /home /plan /create /inbox /results "/plan@390"
```

Known: `seed-tasks-preview.ts` and `seed-reports-preview.ts` refused on this database (details withheld by design); investigate before relying on Tasks/Reports fixtures. See also [../PREVIEW.md](../PREVIEW.md).

## 3. Verification per batch

| Check | How | Pass |
|---|---|---|
| Typecheck | `cd rebuild && npx tsc --noEmit -p .` | 0 errors |
| Unit / render | `npx vitest run <targeted files>`, then full suite before merge | green |
| Token tests | `tests/theme-contrast*.test.ts` + new uniqueness / control-border / no-dark-only-selector tests | green |
| Copy tests | `tests/ui-copy-coverage.test.ts` extended; banned-word test | green |
| Build | `npm run build` | succeeds |
| Screenshots | `scripts/preview-screenshots.cjs`, desktop 1440 + phone 390, Vivid light and Warm dark at minimum; attach to PR | reviewed, no clipping/overflow |
| Browser matrix | `scripts/browser-matrix*.ts` (see BROWSER_MATRIX_2026-10-21.md) on changed routes: Chromium + Firefox + WebKit, 4 themes × light/dark/system, desktop/phone, keyboard walk, injected failure | 0 new findings |
| Parity | UI/REST/MCP tests for any service touched | green |

Record each run's scope honestly (synthetic local vs live provider vs production), as the contract requires.

## 4. Design review checklist (copy into each PR)

- [ ] Uses only shared components; no new route-local control styles
- [ ] Tokens only; no raw colour/size; no `data-mode="dark"` outside palettes
- [ ] One primary action per view; actions next to the work
- [ ] Filters through FilterButton; channel scope respected
- [ ] Numbers first; every caveat in ⓘ; partial = ⚠
- [ ] No banned words; EN and FR present
- [ ] Empty, no-match, loading, error, permission, partial states designed
- [ ] Phone 390 px: no horizontal scroll, ListRows, BottomBar not covering content
- [ ] Keyboard path and focus return verified
- [ ] Screenshots attached (desktop + phone, two themes)
