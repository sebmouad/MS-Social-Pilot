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

## Workspace roles (per workspace) — `src/lib/constants.ts`
Order: owner 4 > admin 3 > editor 2 > contributor 1. A workspace owner is
**not** root.

| Capability (function) | Minimum role |
|---|---|
| Connect/remove Pages and accounts (`canManageAccounts`) | admin |
| Invite, change roles, Page access per member (`canManageTeam`) | admin |
| Workspace settings (`canManageSettings`) | admin |
| Approve / reject posts (`canApprove`) | admin |
| Delete comments (`canDeleteComments`) | admin |
| Reply / hide comments (`canModerateComments`) | editor |
| Publish without approval (`canPublishWithoutApproval`) | editor |
| Edit or delete other people's posts (`canManageOthersPosts`) | editor |
| Delete media (`canDeleteMedia`) | editor |
| Compose drafts (`canCompose`) | contributor (everyone) |

Marking an inbox comment or conversation done / not done (`POST /api/inbox`)
needs no role: any member who can see the Page may do it, like reading it.
It changes only the team's shared state in this app, never Facebook.
**For the owner's audit (2026-10-12).**

Notifications about one Page (failed post, hourly inbox email) go only to
members who may see that Page and did not mute it there. Before 2026-10-12 a
failed-post email went to every member of the workspace. Each member sets
their own mutes; nobody sets them for someone else. The "nothing scheduled
any more" email goes only to owners, admins and editors (the roles that
schedule), under the same Page rules; contributors do not get it.

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
- `/root/*` (`src/app/(root)/root/`): Overview · Configuration · Workspaces ·
  Users · Registration & invitations · Privileges · Worker & Meta usage ·
  Alerts · Backups · Root activity · Danger zone.
  Guard `requireRoot()` (pages) / `requireRootApi()` (`/api/root/*`): 404 for
  everybody but root, signed out included. Sidebar entry "Root" (amber, shield)
  only for root; banner on every root screen; "Back to the app".
- `/settings/config` redirects root to `/root/config`, 404 for others;
  `/api/settings/config*` re-export the `/api/root/config*` handlers.
- Users: disable / enable (`User.disabledAt`; disabled = sessions deleted,
  sign-in refused, existing cookie no longer signs in; root cannot be
  disabled), sign out everywhere. Workspaces: list + rename. Invitations across
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
