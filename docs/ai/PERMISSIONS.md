# Privileges: root and roles (for the owner's audit)

Owner's rule (2026-10-11): **the first registered user is root and can set up
every aspect of the app. Other admins and users have separate privileges; the
owner will audit them later.** Keep this file true whenever a check changes.

## Root (installation owner) — already in the code
- Set once: `registerUser()` in `src/lib/auth.ts` marks the **first account ever
  created** `isInstanceOwner = true` (inside a transaction with an advisory
  lock, so two simultaneous first sign-ups can't both become root). Nobody
  after that can get it, whatever their workspace role — invited workspace
  "owners" included.
- Check: `canManageInstance(auth)` in `src/lib/constants.ts`.
- Root-only today:
  - Settings → **Configuration** (`/settings/config`, API `/api/settings/config`):
    every integration key and app-wide setting (Facebook app, other networks,
    AI, email, links, retention, media, cron…).
  - The setup wizard and setup checklist (`src/lib/setup.ts`
    `mayChangeSetup`), and the setup card on the dashboard.
- Registration after root: invitation only, unless `openRegistration` is on
  (`admission()` in `auth.ts`).

## Technical details are root's (owner approved, 2026-10-12)
The Meta app panel (redirect and webhook addresses for Meta's dashboard) is
only in Root › Configuration; Connections and its health panel show what a
connection can do in plain words (`src/lib/scope-abilities.ts`), never Meta's
permission names.

## Developer features are switched on by root (owner approved, 2026-10-12)
API keys (and Claude through MCP), outgoing webhooks and their delivery log
are off for every workspace by default (`Workspace.developerFeatures`). Root
switches them on per workspace in Root › Workspaces (logged as
`workspace.developerFeatures`). When on, only **root** sees and manages them
(changed 2026-10-12 at the owner's request: no technical screens for workspace
members, owners included) (`mayUseDeveloperFeatures` in `src/lib/modules.ts`; screens 404,
APIs 403). Switching them off stops existing keys (`errors.developerFeaturesOff`)
and queues no more webhook deliveries; nothing is deleted, so switching back on
restores them. Workspaces that already had a live key or a webhook were
switched on by the migration, so nothing in use stopped.

## Workspace privileges view is root-only (owner request, 2026-10-12)
Settings › Permissions (who may do what in a workspace) shows to root only;
workspace owners and admins no longer see it. Root › Privileges covers it.

## Workspace roles (per workspace) — `src/lib/constants.ts`
Order: owner 4 > admin 3 > editor 2 > contributor 1 > viewer 0 = client 0.
A workspace owner is **not** root.

Names shown in the app (owner approved, 2026-10-12): owner = **Agency owner**,
admin = **Admin**, editor = **Manager**, contributor = **Creator**, viewer =
**Viewer**, client = **Client**. The code keeps the enum values.

**Viewer** (owner approved, 2026-10-12): reads everything in its channels and
changes nothing. Every signed-in API write (`POST/PUT/PATCH/DELETE`) is refused
in `requireAuth` (`mayWrite` in `src/lib/role-access.ts`, 403
`errors.viewerReadOnly`), except its own things: `/api/account`, `/api/auth`,
`/api/notifications`, `/api/calendar-feeds`, `/api/exports`. No composer
(`canCompose` is contributor+; `/compose` sends a viewer to the calendar), and
the screens that only exist to change things are hidden (compose, templates,
content mix, saved replies, moderation rules, client links). Can be limited to
some channels like any non-admin.

**Client** (owner approved, 2026-10-12): the agency's customer. The only
capability is `approve` (`CLIENT_CAPABILITIES` in `src/lib/constants.ts`):
approve or reject posts and add notes on them. Screens (`mayOpenScreen`, same
list in the sidebar, the settings menu and `requirePage`): calendar, posts,
approvals, own account and notifications. Each workspace may open more on
Settings › Team (`Workspace.clientAccess`, admins via `canManageSettings`):
`analytics` (analytics and reports, read only), `inbox` (read only; replying
stays with the team) and `library` (media library, uploads allowed). Default:
`analytics` only. Never settings, team, connections, API or anything
technical. API writes (`mayWrite`): own things as for the viewer, plus
`/api/posts/:id/approve`, `/api/posts/:id/notes`, and `/api/media` with the
library switch; everything else 403 `errors.noPermission`. A client lands on
the calendar; a screen that is not theirs redirects there. A client cannot be
promoted and a team member cannot be made a client (`changeRole`, 409
`errors.clientRoleFixed`); root can still change any role. Clients get no
approval emails (`approverRoles` excludes them). Can be limited to some
channels like any non-admin. **Not built yet:** the "connect own Pages"
switch — connecting goes through `canManageAccounts` in many routes and would
also have to add the new channels to the client's access; left for the
owner's audit.

| Capability (function) | Minimum role |
|---|---|
| Connect/remove Pages and accounts (`canManageAccounts`; includes removing one Page, `DELETE /api/targets/:id`) | admin |
| Invite, change roles, Page access per member (`canManageTeam`) | admin |
| Workspace settings (`canManageSettings`), incl. key dates, seasonal modes and content mix (outgoing webhooks: owner only, see above) | admin |
| Approve / reject posts (`canApprove`) | admin, or client |
| Delete comments (`canDeleteComments`) | admin |
| Reply / hide comments (`canModerateComments`) | editor |
| Publish without approval (`canPublishWithoutApproval`) | editor |
| Edit or delete other people's posts (`canManageOthersPosts`) | editor |
| Delete media (`canDeleteMedia`) | editor |
| Add, change, remove post templates (`canManageTemplates`, NEXT_PHASES H4; using one needs no role) | editor |
| See a post's version history (NEXT_PHASES H9): same as editing it — its author, or `canManageOthersPosts`, within the member's Pages | contributor (own posts) |
| Read and add internal notes on a post (NEXT_PHASES H8): any member who may see all its Pages; remove a note: its author, or `canManageOthersPosts` | contributor |
| Set a Page's monthly goals (NEXT_PHASES H12): uses `canManageSettings`, like the Page's other settings; seeing them needs no role | admin |
| Add or remove notes on analytics charts (NEXT_PHASES H13): editor+, like report templates; a member limited to some Pages notes only those and cannot write an "every Page" note. **For the owner's audit (2026-10-12).** | editor |
| Make and revoke own calendar feeds (NEXT_PHASES H19); a feed shows only the Pages its member may see when it is read | contributor (everyone) |
| Compose drafts (`canCompose`) | contributor (everyone) |

Marking an inbox comment or conversation done / not done (`POST /api/inbox`)
needs no role: any member who can see the Page may do it, like reading it.
It changes only the team's shared state in this app, never Facebook.

Moderation rules (`/inbox/rules`, `/api/moderation/*`) use the existing
`canModerateComments` (editor+): a rule only hides, replies or alerts, which an
editor may already do by hand, and undoing one is the same right. A member
limited to some Pages sees and edits only rules that name only their Pages,
and cannot write an "every Page" rule. **For the owner's audit (2026-10-12).**

Export everything (`/settings/export`, `POST /api/exports`,
`GET /api/exports/[id]`, NEXT_PHASES G17): **workspace owner only**, not
admins. The ZIP holds every Page's posts, comments, schedule, analytics and
media of the workspace, never tokens; it expires after 7 days. Requests are
logged as `workspace.exported`. **For the owner's audit (2026-10-12).**

Notifications about one Page (failed post, hourly inbox email) go only to
members who may see that Page and did not mute it there. Before 2026-10-12 a
failed-post email went to every member of the workspace. Each member sets
their own mutes; nobody sets them for someone else. The "nothing scheduled
any more" email goes only to owners, admins and editors (the roles that
schedule), under the same Page rules; contributors do not get it. The
"your post was changed" email goes to the post's author only, if still a
member.

Plus **Page scope** per member: a member sees and acts only on the Pages they
are given (`auth.pageScope`, applied by `loadPageFilter`). Every action is
recorded in `ActivityLog` (Settings → History, admins).

## Root has its own section (owner's rule, 2026-10-11)
Root access lives in **a unique section, separated from the rest of the app**:
- **Own route prefix `/root/*`** (layout `src/app/(root)/root/layout.tsx`) with
  its own sidebar: Overview · Configuration · Workspaces · Users · Registration
  & invitations · Privileges (audit) · Root activity log · Danger zone
  (transfer root). Not inside workspace Settings, not tied to any workspace.
- **Move** Settings → Configuration (`/settings/config`, `/api/settings/config`)
  and the setup wizard/checklist there (`/root/config`, `/api/root/config`,
  `/root/setup`); old URLs redirect to the new ones for root, 404 for others.
- **Entry point**: one item at the bottom of the main sidebar, only for root
  ("Root" with a shield icon, distinct colour); the root section shows a
  persistent banner "Root — changes affect the whole installation" and a
  "Back to the app" link. Non-root users never see the link, and every
  `/root/*` page and `/api/root/*` route returns 404 for them (not 403, so the
  section isn't advertised).
- **One guard**: `requireRoot()` in `src/lib/auth.ts`, used by the root layout
  and every root API route; e2e asserts each `/root/*` and `/api/root/*` path
  is 404 for admin, editor, contributor and signed-out users.
- **Separate log**: every root action written to `ActivityLog` with
  `scope = 'root'`, shown only in the root section.
- Workspace roles (owner/admin/…) keep using workspace Settings; nothing of the
  root section appears there.

## Workspace isolation (owner's rule, 2026-10-11)
Each workspace is one client: its own data and team, and nobody in another
workspace can see or touch it — workspace owners included. Enforced by every
query filtering on `auth.workspace.id` (+ `pageScope`), and pinned by
`tests/tenant-isolation.integration.test.ts`: as workspace B's owner it calls
every `[id]` API route with workspace A's real ids (must answer 404/403 and
change nothing), every list route (must not mention A), and passes A's Page
ids in bodies (nothing may end up pointing at them). A new `[id]` route fails
that test until it is mapped. Root sees every workspace in the root section
and may open one as its owner (logged visit, see below).

## Two kinds of invitation (owner, 2026-10-11 — beta before selling)
- **Join an existing workspace**: a workspace owner/admin invites from
  Settings → Team (`Invitation`, role chosen there).
- **Create their own workspace**: root invites a client from Root →
  Registration & invitations (`ClientInvitation`, 14 days, optional suggested
  workspace name). Only that address is admitted; registering creates the
  client's own workspace, isolated like every other, with them as owner. The
  link is shown to root as well as emailed.

## Built (2026-10-11)
- `/root/*` (`src/app/(root)/root/`): Overview · Agency overview · Configuration · Workspaces ·
  Users · Registration & invitations · Privileges · Worker & Meta usage ·
  Alerts · Backups · Root activity · Danger zone.
  Guard `requireRoot()` (pages) / `requireRootApi()` (`/api/root/*`): 404 for
  everybody but root, signed out included. Sidebar entry "Root" (amber, shield)
  only for root; banner on every root screen; "Back to the app".
- `/settings/config` redirects root to `/root/config`, 404 for others;
  `/api/settings/config*` re-export the `/api/root/config*` handlers.
- Users: disable / enable (`User.disabledAt`; disabled = sessions deleted,
  sign-in refused, existing cookie no longer signs in; root cannot be
  disabled), sign out everywhere. Sessions (`/root/sessions`): every
  signed-in browser on the installation (person, browser, IP/country, last
  seen), and root can end any one (logged). A person ends only their own
  (`DELETE /api/account/sessions/[id]`, scoped to the signed-in user). Workspaces: list + rename. Invitations across
  every workspace + revoke. Open registration switch.
- Transfer root (root's password; both emailed) and the SSH recovery script
  `scripts/admin/set-root.ts <email>` (RELEASE.md).
- `RootActivity` table = the separate root log (a table of its own rather than
  `ActivityLog`, which belongs to a workspace).
- `CAPABILITIES` in `constants.ts` is the single table the `can…` functions
  read; printed at `/root/privileges` (+ every member's role, Page access,
  last sign-in, CSV export) and read-only for admins at `/settings/permissions`.
- Still not built: deleting users, creating a workspace from the root section.

## Root oversight and modules (owner, 2026-10-11 — "root sees all; clients
only get what root configured, activated and authorised; root can change
anything")
Built as a first, customisable version (`tests/root-oversight.integration.test.ts`):
- **Modules** (`src/lib/modules.ts`: analytics, ads, schedule). Root switches
  them off per workspace (`Workspace.disabledModules`) and per member
  (`Membership.disabledModules`). What a member may use =
  `enabledModules(workspace, member)` → `auth.modules`. Switched-off modules
  have no sidebar links; their screens 404 (`requirePage` + the (app) layout)
  and their API routes answer 403 (`requireAuth`), using the request path that
  `src/middleware.ts` passes in `x-msp-pathname` and `moduleOfPath()` (API
  prefixes listed there). Shared screens (dashboard, connections, settings)
  belong to no module and stay.
- **Suspend / resume a workspace** (`Workspace.suspendedAt`): members see a
  notice instead of their screens, API calls answer 403, the scheduler holds
  its posts (`findDue` skips it) until resumed. Root still gets in.
- **Open any workspace as root** (`POST /api/root/workspaces/[id]/visit`):
  root acts as its owner without a membership row (cookie `msp_root_visit`,
  honoured only for root), an amber banner with "Leave workspace" shows on
  every screen, and each visit is logged (`workspace.visited`). Leaving or
  switching workspace ends it.
- **Members** (`/root/workspaces/[id]`): add an existing account with a role,
  change a role, switch modules off for one person, remove. A workspace always
  keeps an owner (last owner cannot be re-roled or removed).
- Every change is in Root activity. Roles' capability matrix is unchanged.
- Next to customise: plans (module bundles per client), per-member Page access
  from root, limits per workspace (profiles, posts, AI budget).

## To build (NEXT_PHASES Phase 0.3)
1. **Root console** (inside the `/root` section above): all workspaces (create,
   rename, suspend, open any as root), all users (disable, reset sign-in,
   remove, see memberships), open registration on/off, invitations across the
   app. Today root only sees workspaces it belongs to — verify, then close the
   gap.
2. **Root reaches everything**: root passes every workspace check
   (`atLeast()` treats root as above owner) — decide with the owner; default
   proposed: yes, with every root action in `ActivityLog` flagged "root".
3. **Transfer root** to another user (confirm with the root's password, both
   sides notified) — and a recovery path documented in `RELEASE.md` (server CLI
   script `scripts/admin/set-root.ts <email>`, run over SSH), never a web
   back door.
4. **Privileges screen for the audit** (`/root/privileges`; admins get a
   read-only view of their own workspace at `/settings/permissions`): the matrix above generated from the code (one source:
   a `CAPABILITIES` table in `constants.ts` that the functions read), plus per
   member: role, Page scope, last sign-in, recent actions. Exportable CSV.
5. **Custom role tweaks** only after the owner's audit — don't change the
   matrix before the owner has reviewed it.
6. Tests: first sign-up race (two at once → one root); invited "owner" is not
   root; non-root gets 404 on every `/root/*` and `/api/root/*` route; capability table matches the functions.

## Plans (owner approved, 2026-10-12)
Root › Plans (`/root/plans`, `src/lib/plans.ts`): root edits each plan's prices,
limits (channels, team members, workspaces, posts and AI credits a month) and
features, puts each subscriber (a user who owns a workspace) on a plan and
grants extra channels. Limits count across every workspace the subscriber
owns, and are enforced on new workspaces, team invitations (clients are free)
and new channels (402 `errors.planLimit_*`; a Facebook sync leaves the extra
Pages out with a warning). Root and users with no plan have no limits; new
sign-ups start on the default plan. Seeded: Free, Solo, Team, Agency,
Agency+. Posts and AI generations per calendar month (UTC, across the
subscriber's workspaces) are enforced in `createPost` and every AI call
(`errors.planLimit_postsPerMonth` / `_aiCredits`). Features: `api` gates new
API keys, `clients` gates inviting the client role, `whiteLabel` gates
setting a logo or report branding (`errors.planFeature_*`). No payment
provider yet. Every change is in root activity.

## Root creates and deletes (owner request, 2026-10-12)
Root can create a workspace for any existing account (that account becomes its
owner), delete a workspace with everything in it, and delete any account except
root's own. An account that is the only owner of a workspace cannot be deleted
until the workspace has another owner or is deleted; its posts stay, credited
to root. Each action is logged in Root › Activity. Code: `src/lib/root.ts`
(`createWorkspaceAsRoot`, `deleteWorkspaceAsRoot`, `deleteUserAsRoot`).

## Agency access (owner request A7, 2026-10-12)

Workspace owners get an Agency screen (`/agency`): every workspace they own,
side by side, and a grid of people × clients. From it an owner can give a
person who is already on one of their workspaces a role (admin, editor,
contributor or viewer) in another workspace they own, change it, or remove it.
It never adds strangers (they are still invited from Team), never touches owner
or client memberships, and goes through the same `changeRole` / `removeMember`
rules and plan seat limits as the Team screen.
