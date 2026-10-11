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
that test until it is mapped. Root sees all workspaces only in the root
section (names, counts), never their posts, Pages or tokens.

## Built (2026-10-11)
- `/root/*` (`src/app/(root)/root/`): Overview · Configuration · Workspaces ·
  Users · Registration & invitations · Privileges · Root activity · Danger zone.
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
- Not built, waiting on the owner: root passing workspace checks / opening
  another workspace (item 2 below), suspending a workspace, deleting users.

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
