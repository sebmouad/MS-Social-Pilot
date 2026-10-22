# Customer browser matrix / Matrice navigateur client

This is release-gate-4 tooling, not evidence that the gate has passed. It uses
the installed Playwright and Chromium. It never installs packages/browsers,
starts servers, seeds data, changes Root settings or publishes. Use an
already-running loopback rebuild with a dedicated synthetic QA database.

Cet outil prépare le contrôle navigateur de livraison ; sa présence ne prouve
pas sa réussite. Utiliser une application locale déjà démarrée, une base QA
synthétique et les navigateurs Playwright déjà installés.

From `rebuild/`, provide `BASE_URL`, `QA_EMAIL`, and `QA_PASSWORD` through the
process environment, for example via a secret manager. Never put credentials in
command arguments, shell history, committed files or reports. The QA account
needs current access to all customer modules, a workspace and permission to open
New task. Use an account without a two-step challenge; enrollment/challenge
redirects fail authentication rather than bypassing it.

Depuis `rebuild/`, fournir ces trois variables par l'environnement du processus.
Le compte QA doit accéder à tous les modules et pouvoir ouvrir une nouvelle tâche.
Un défi de double authentification nécessite une vérification séparée.

```sh
BASE_URL=http://127.0.0.1:3200 \
BROWSER_MATRIX_REPORT=/tmp/msp-browser-matrix.json \
node --import tsx scripts/verify-browser-matrix.ts
```

`QA_EMAIL` and `QA_PASSWORD` must already be exported. `BASE_URL` accepts only an
HTTP(S) origin at localhost, 127.0.0.1 or [::1], without user info, path, query or
fragment. Browser requests are confined to that exact origin; only GET/HEAD and
the initial sign-in POST are allowed. WebSockets are blocked. Authenticated inspection blocks writes,
including server actions. The task editor opens/closes without submitting.
Server-side effects of ordinary page reads remain the application's
responsibility; this is why a dedicated QA database matters.

Le réseau du navigateur est limité à l'origine locale exacte. Après connexion,
les écritures sont bloquées. L'éditeur de tâche est fermé sans enregistrement.
Les effets serveur éventuels des lectures nécessitent une base QA.

The runner discovers all static `page.tsx` customer routes under `/home`,
`/publishing/*`, `/inbox/*`, `/analytics/*`, `/ads/*`, `/settings/*`, `/tasks` and
`/agency` (including `/agency/clients`). Root, public and authentication routes
are excluded. Dynamic record routes appear in `excludedDynamicRoutes`; test
those separately with fixture-specific workflows. Each static route gets a fresh
page in Grove, Coast, Clay and Nightfall at **1440×900** and **390×844**. Themes
use the existing `social-pilot-theme` cookie; the applied value is checked.
Sessions stay in memory and browser contexts close on completion.

Chaque route statique est testée dans les quatre thèmes et les deux tailles.
Les routes dynamiques exclues figurent au rapport ; elles nécessitent des
scénarios avec identifiants de données synthétiques.

Checks cover console errors, uncaught page errors, hydration warnings, document
horizontal overflow and accessible names on visible buttons and form controls.
Controls are inspected again inside open drawers and dialogs. Keyboard checks
Tab to the first available primary content action, then a sidebar primary action,
otherwise a content button/link; the selected target selector is recorded. Focus requires `:focus-visible`,
an outline/shadow and viewport intersection. Arbitrary actions are never clicked.
The phone drawer and New task editor check Enter opening, focus inside, Tab
inside, Escape closing and focus returning to the opener. At least one verified
dialog is required for every theme/viewport pair. Missing main actions, redirects,
HTTP failures, theme mismatches and incomplete matrices fail. Routes without a
safe dialog probe report `Not available`, never a fabricated success.

Les contrôles couvrent erreurs console/hydratation, débordement horizontal,
noms accessibles et navigation clavier. Échap ferme les dialogues testés et rend
le focus au déclencheur. Un contrôle absent indique `Not available` ; une
matrice incomplète, un accès refusé ou une erreur entraîne un échec.

JSON includes route templates, dimensions, themes, outcomes, stable failure codes
and error fingerprints, never raw console messages, DOM text, credentials,
request bodies or session state. Fingerprints group errors without retaining
content. `passed` requires complete coverage and no failures. Exit **0** means
pass; **1** means findings, configuration/browser/sign-in or report-write failure.
Default output: `/tmp/msp-browser-matrix.json`; override with
`BROWSER_MATRIX_REPORT`. Files are created with mode 0600. Keep reports outside Git.

Le rapport JSON ne contient ni identifiants de connexion, ni sessions, ni texte
client. Code de sortie : **0** réussite, **1** échec. Choisir le chemin de sortie
avec `BROWSER_MATRIX_REPORT` ; conserver le rapport hors Git.

```sh
npx vitest run tests/browser-matrix.test.ts tests/raw-sql-void-guard.test.ts
npx tsc --noEmit -p .
```

## Design v2 area matrix (`BROWSER_MATRIX_SCOPE=v2`)

Every v2 area — Home, Create, Content, Inbox, Insights, Settings, Root —
in light and dark, at desktop (1440×900) and phone (390×844) widths, with
keyboard navigation, in EN and FR. The theme defaults to Clean
(`MATRIX_THEMES` may narrow or widen it); `MATRIX_ONLY` narrows routes by
prefix. Sign-in happens once in English; every locale/mode/viewport cell
reuses that session. Each cell checks console/page errors, HTTP status,
redirects, applied theme/mode/locale, horizontal overflow, accessible
control names, contrast and the keyboard walk (Tab to the page action on
every cell; the phone navigation drawer is the shared dialog probe).
Current inventory: 67 static routes, 536 cells on the default theme.

```sh
BROWSER_MATRIX_SCOPE=v2 \
BASE_URL=http://127.0.0.1:3200 \
BROWSER_MATRIX_REPORT=/tmp/msp-v2-matrix.json \
node --import tsx scripts/verify-browser-matrix.ts
```

`QA_EMAIL` and `QA_PASSWORD` must already be exported (or point
`QA_CREDENTIALS_FILE` at a local JSON `{email,password}`). Serve an
already-running loopback rebuild on `BASE_URL` with the dedicated
synthetic preview database from [PREVIEW.md](PREVIEW.md) (baseline
migration applied, `seed-preview.ts` run); the QA account must be the
instance owner so Root routes render. Dynamic record routes
(`/content/post/[postId]`, `/root/errors/[id]`, `/root/modules/[id]`,
`/root/platforms/[id]`) are reported as exclusions; test those separately
with fixture-specific workflows.

Unit tests verify completeness, guards and private error classification without
launching browsers. No actual matrix run is claimed in this batch: no server or
QA credentials were started/provided. A passing matrix is baseline evidence;
full focus trapping, screen-reader review, visual contrast, dynamic details,
failure/retry workflows, provider operations and production readiness still need
separate evidence.

Les tests unitaires ne lancent pas de navigateur. Aucune exécution réelle de la
matrice n'est revendiquée ici. Scénarios métier, lecteurs d'écran, contrastes,
états d'erreur et vérifications fournisseur restent des contrôles distincts.
