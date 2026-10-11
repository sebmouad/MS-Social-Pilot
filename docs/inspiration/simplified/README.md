# Simplified (app.simplified.com) — reference for MS Social Pilot

Explored 10 October 2026 on the "Mouad" workspace (trial), accounts For Lady's and
Délices Rapides. Read-only: nothing was created, saved or published.
Screens are in [`screens/`](screens/) — numbers below refer to them.

We borrow **structure and behaviour**. Our look stays Facebook-like (light,
`#1877F2`), so the token table is for proportions and hierarchy, not colours.

---

## 1. Visual style (design tokens, measured in the DOM)

| Token | Value | Notes |
|---|---|---|
| Page background | `#1E1E1E` | dark theme only |
| Card / tile background | `#2A2A2A` (KPI) · `#232323` (panels) | 1 px border `rgba(255,255,255,.08)`, radius **8 px**, padding **16 px** |
| Text | primary `#FFFFFF` · body `rgba(255,255,255,.92)` · secondary `#D8D8D8` · muted `#939393` / `#ADADAD` | |
| Accent (brand) | `#FFAD00` amber | primary buttons (dark text `#1E1E1E`), active tab underline, today's date circle, "selected" pill outline |
| Negative change pill | bg `#D64258`, white text, **fully rounded**, 12 px, padding `2px 8px`, ↓ arrow | |
| Positive change pill | green bg, white/dark text, ↑ arrow | same shape |
| Chart series | pink `#FF4F8B`-ish (impressions), green `#8BE04E` (engagement/reach), blue `#3B82F6` (audience/reactions), orange `#FFAD00` (posts), violet (post engagements) | each KPI owns one colour everywhere: card sparkline + big chart |
| Chart style | smooth curve (monotone), dots on each day, soft gradient area fill under the line, faint grid, small axis labels, 1 k / 1,8 k compact numbers | |
| Fonts | **Inter** (UI, numbers) · **Bricolage Grotesque** (section titles, KPI labels) | KPI value 28 px / 500, label 14 px / 500, section title 16 px / 500 |
| Sidebar | 256 px wide, items 14 px / 500, radius 6 px, active item bg `rgba(255,255,255,.08)` | plus 40 px icon rail on the far left |
| Inputs / selects | bg `rgba(0,0,0,.16)`, 1 px border, radius 8 px, padding `6px 12px` | |
| Primary button | amber, radius 8 px, height ~32 px, padding `0 12px`, split button with a ▾ part | "Nouveau Rapport ▾", "Nouveau post ▾", "Calendrier ▾" |
| Tabs | text 14 px / 500, padding `8px 16px`, active = white + amber 2 px underline; inactive tabs collapse to **icon only** | (01, 06, 07) |
| Segmented pills | "À venir / Précédent", "Préréglages / Personnalisé": rounded-full, selected has amber outline | (03, 20) |
| Empty states | grey illustration (card icon), one line "Aucun post ici. Pour le moment !", amber CTA | (20, 38) |
| Toast | top-right card, red icon, title "Erreur" + one line | (29) |
| Locked premium features | full marketing page: big headline, 1-line pitch, two buttons (sales / upgrade), video, then 3–4 alternating "Step" blocks with bullet lists | (33–37) |

## 2. App shell

- **Icon rail** (far left): Nouveau (+), Accueil, Riley (beta), Agents (beta),
  Projets, Mes Actifs, Hub IA, Marque, **Médias Sociaux** (active), Tâches, Flux
  de travail, Plus. Workspace switcher at the bottom.
- **Module sidebar** (Médias sociaux): workspace name ▾, big "+ Nouveau post"
  button, then Calendrier · Brouillons · Lien dans la bio · Fonctions d'analyse ·
  Boîte de réception · Calendriers partagés · Révision du client 👑 · Portail
  Client 👑 *Nouveau* · Analytique Concurrentielle · Archives. Footer: setup
  progress "2/5 Configuration de l'espace de travail · 5 min restantes", trial
  banner, "Parlez à des experts en IA".
- **Top bar**: collapse-sidebar, home › breadcrumb "Marketing Social", credits
  (💎 5001 ▾), help, notifications, workspace settings ⚙, avatar.
- **Accounts column** (Publishing, Drafts, Client review): "Tous les comptes ▾"
  (account groups), "+ / 1/3 / 👁 / 🔍", one row per account with avatar +
  network badge, name, "Page Facebook (owner)", 👁 show/hide toggle, ⋮ menu;
  "+ Ajouter un compte". Hidden accounts are greyed. (20, 24, 39)
  - Account ⋮ menu: Paramètres du compte · Reconnecter le compte · Nouveau post
    · Lecture aléatoire de la file d'attente (shuffle queue) · Effacer la file
    d'attente · Effacer les brouillons · **Supprimer le compte** (red). (24)
  - Account groups: "Tous les comptes" + "Nouveau groupe de comptes". (39)
- **Selected accounts strip** above content: stacked avatars + ⋮ (Ajouter un
  compte / Ouvrir la liste complète). (20)

## 3. Analytics (`/analytics/*`)

Header row: account-group button, **account picker** (search, "Ajouter un
compte", "Aperçu de tous les comptes", each account with network badge) (02),
centre tabs **Aperçu · Démographie · Publications · Modèles de rapport**, right:
**date range** + **Nouveau Rapport ▾** (▾ = "Télécharger le rapport Excel") (04).

**Date range popover** (03): tabs *Préréglages / Personnalisé*; presets 7 / 30 /
90 derniers jours; footer "Période de comparaison : 24 sept. – 1 oct. 2026 ⚙"
(comparison period shown and editable).

### 3.1 Aperçu (01, 05, 19)
1. Two **insight tiles** with faint chart background:
   "Meilleur jour pour publier — jeudi — Engagement maximum ce jour-là";
   "Meilleure fréquence pour poster — 5 — Combien de posts publier
   quotidiennement sans submerger ou perdre l'intérêt de votre public".
2. Section **Vue d'ensemble**: 4 KPI cards (Engagement, Impressions, Croissance
   de l'audience, Publication). Card = label · big value · change pill ·
   sparkline in the KPI colour with an end dot. **Cards are a selector**: the
   selected one has a blue outline and drives the big chart below; several can
   be on at once (one line each).
3. Section **Performance**: Portée de la Page · Impressions de post (total) ·
   Nombre de posts (+ ⓘ tooltips) → big chart.
4. Section **Activité**: Réactions · Engagements sur la page des posts → big
   chart.

### 3.2 Démographie (06)
- **Fans**: Nouveaux fans (−73 %) and Total des followers (27 848) cards + chart.
- **Principaux pays**: ranked table (Classement · Pays · Vos fans) + **world
  choropleth map**; select "Vos fans / Population touchée"; "Plus" to expand.
- **Principales villes**: horizontal bar chart + ranked table; same select.

### 3.3 Publications (07, 08, 09)
- Table: thumbnail + 2-line caption · **Publié** (date, time, "(Europe/Paris)")
  · Commentaires · Clics · Engagements · Impressions · Likes · Réactions ·
  Partages. Every header sorts (▾). Filter on Publié: ☑ Publié via Simplified,
  ☑ Publié externe (Appliquer / Annuler).
- Pagination: 10 / 25 / 50 posts, page select "1 / 5".
- Row click → **"Renseignements sur les posts" modal**: left = post (source
  badge "Publié (externe)", date, text, thumbnail, account avatar); right =
  "Métriques — Totaux généraux" 2-column tiles (Likes, Partages, Commentaires,
  Réactions, Clics, Impressions, Engagements); header button **Ouvrir le post**.
- ⚠ Their "Engagements" column shows 500 %–1700 % — a bug; don't copy.

### 3.4 Modèles de rapport & Nouveau rapport (10–17)
- Templates list with search; empty: "Vous n'avez pas encore de modèles".
- "Créer un nouveau rapport": **Commencer un nouveau** / **Mes modèles**.
- Builder dialog: accounts (multi, or group) · Période & Format (date range,
  **PDF / PNG**) · "Aperçu & Personnaliser" · toggle "Enregistrer en tant que
  nouveau modèle" · Quitter / **Créer un rapport**.
- Aperçu & Personnaliser (full screen): live paginated preview left, panel right
  with two tabs:
  - **Branding**: Afficher le logo (toggle), Logo de couverture, Titre
    ("Rapport d'analyse"), Sous-titre, Texte du pied de page, Logo du pied de
    page.
  - **Modules** (checkbox tree): Tous · Aperçu (Engagement, Impressions,
    Publication, Croissance de l'audience) · Aperçu par réseau · Meilleures
    publications · Liste des posts · Public · Graphiques des comptes
    (Engagements sur la page des posts, Impressions de post total, Impressions
    organiques, Nombre de posts, Nombre total de fans, Nouveaux fans, Portée de
    la Page, Portée des posts organique / payant / total / virale, Réactions,
    Total des followers) · Comparaisons de périodes ⓘ.
  - Report pages: cover (logo, title, date range) → section pages with a header
    (title, dates, account chip top-right) → KPI rows with sparklines → charts →
    "Meilleures publications" 4 cards (image, date, text, metric table).
  - Footer: Annuler / Appliquer les modifications.

### 3.5 Analytique concurrentielle (18)
Marketing page until you "Suivre un concurrent" (add a Facebook Page): active
ads (run time, AI score, creative/copy/CTA/landing page), recent posts
(reactions, comments, shares, views), follower growth, posting rhythm, compare
competitors.

## 4. Publishing (`/publishing/*`)

Views (top tabs, icon-only when inactive): **Calendrier · Liste · Flux entrant ·
Grille**. Right: "✨ Meilleur moment pour publier", **+ Nouveau post ▾**.
Toolbar: 🔍 search posts · filter · ⬇ export posts · ⋮.

- **Liste** (20): pills À venir / Précédent; empty state + "Programmer un post".
- **Calendrier** (21, 40): "Mois ▾" (view mode) · ⊙ today · ‹ 📅 › · title
  "octobre 2026" · toggle **Brouillons** (show drafts) · clock (current time,
  timezone). Month grid Mon→Sun; **awareness days** pre-filled as green-dot
  chips (World Heart Day, World Coffee Day, Halloween…). Today = amber circle.
  Hovering a day shows 💡 (idea) ⊕ (new post) ⊖ icons.
- **Flux entrant** (22) and **Grille**: preview of the account's feed as it will
  look (profile header + posts); pills Tous / À venir / Précédent; account
  select.
- **Meilleur moment / account settings dialog** (23, 25, 26) — per account,
  with account select + "Actualiser les données du compte":
  - *Généralités*: custom image for the account; link shortening on/off.
  - *Liens UTM*: on/off, Source (`facebook.page`), Medium (`social`), Campaign
    (`simplified`), Enregistrer.
  - *Horaire*: "✨ Meilleur moment pour publier" (AI), weekly grid Lundi→Dimanche
    of **time slots** ("Pas de timepoints ici"), add slot: scope "Seulement ce
    compte ▾" · days "Everyday ▾" · time · Ajouter. = our queue slots.

### 4.1 Composer "Programmer un post" (27–31)
Full-screen overlay, blurred colourful background.
- Left column card:
  - account selector row (group button + avatars + ⋮);
  - tabs: 🗓 (global/common) · **Facebook** (per-network override);
  - type pills **Post · Reel · Story**;
  - editor "Rédigez des posts ici…", bottom toolbar: **+** media (Générer des
    images IA · Médiathèque · Charger le média) · **Aa** background colour
    (Facebook coloured text posts; "En vedette" swatches + Effacer) · 📍
    location · ◎ · @ mention · **✨ Assistant IA** · # hashtags (AI) · 📄
    templates/snippets · 😊 emoji · counters "0 · #0 · @0" · undo.
  - **+ Commentaire** → first comment with **Délai: Jours / Heures / Minutes**
    after publishing, its own toolbar (+, ✨, #, snippet, 😊), Annuler /
    Enregistrer.
  - **Étiquettes** (labels/tags) dashed field.
  - Footer: ☐ Enregistrer comme groupe · Enregistrer le brouillon ·
    **Calendrier ▾** (Calendrier / Ajouter à la file d'attente / Publier
    maintenant).
- Right column: **live Facebook preview** card (Page avatar, "1 min · 🌐", J'aime
  / Commentaire / Partager), collapsible per network; header toggles preview
  (eye) and close.

## 5. Other modules

- **Brouillons** (32): Kanban **Brouillons · En attente d'approbation · Prêt à
  publier (⚙) · Rejeté**, each with a count; views Panneau · calendar · list ·
  folders; "+ Nouveau brouillon ▾".
- **Boîte de réception** (33): locked — "Écoutez et répondez aux messages",
  "Activer la boîte de réception" + video. URL `/inbox/streams/all`.
- **Calendriers partagés** (34, Agency plan): public read-only calendar link per
  client — choose accounts, dynamic date range, shows scheduled / published /
  failed, title + description, enable/revoke link.
- **Révision du client** (35, paid add-on): review "bundles" — name,
  description, comments on/off, **auto-schedule after approval**; add drafts;
  share link (copy / email recipients); brand logo; client approves / rejects /
  comments **without an account**.
- **Portail client** (36, Agency): one branded link per client with chosen
  accounts, date range and sections; list + calendar of upcoming posts;
  approve / request changes / comment; enable/disable access.
- **Lien dans la bio** (37): link-in-bio page builder (URL, bio, links, themes).
- **Archives** (38): tabs Publications archivées / Publications passées, search.

---

## 6. What MS Social Pilot should take (priority)

| # | Idea | Where in our app | Effort |
|---|---|---|---|
| 1 | **KPI cards as chart selector** with sparkline + change pill, one colour per metric used everywhere | Analytics overview, Page analysis | S |
| 2 | **Insight tiles** "Best day / Best frequency" in plain words | Analytics top, Dashboard hub | S |
| 3 | **Report builder**: modules checklist, branding (cover logo, title, subtitle, footer), PDF/PNG, save as template, live preview | Reports | L |
| 4 | **Countries & cities** with map + fans / reach switch | Analytics → Audience | M |
| 5 | **Post table**: source filter (via app / external), 10/25/50 rows, sortable columns, row → metrics modal with "Open on Facebook" | Analytics → By post | S |
| 6 | **First comment delay** (days/hours/minutes) | Composer first comment | S |
| 7 | **Composer split button** Schedule ▾ (Schedule / Add to queue / Publish now) + "Save draft"; type pills Post/Reel/Story; per-network tab | Composer | M |
| 8 | **Account column with 👁 show/hide and ⋮ menu** (settings, reconnect, new post, shuffle/clear queue, clear drafts) + **account groups** | Calendar, Queue, Posts | M |
| 9 | **Per-account settings**: UTM params, link shortening, queue time slots grid | Settings → Pages | M |
| 10 | **Calendar**: drafts toggle, awareness days, day-hover actions (idea / new post), today button | Calendar | S |
| 11 | **Drafts kanban** Draft → Pending approval → Ready → Rejected | Approvals | M |
| 12 | **Client review link** (approve/reject/comment without an account) & shared read-only calendar | Approvals / new "Share" | L |
| 13 | Comparison period visible in the date picker footer | Shared date range | S |
| 14 | Facebook coloured-background text posts (Aa) | Composer | S |
| 15 | Competitor tracking (public Page + Ad Library) | New module; needs Meta permissions | L |

Don't copy: dark theme (we're Facebook light), percentage "engagements" bug,
marketing pages blocking features, AI buttons that spend credits on click.
