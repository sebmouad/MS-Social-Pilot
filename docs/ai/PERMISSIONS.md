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

## To build (NEXT_PHASES Phase 0.3)
1. **Root console** (`/settings/root`, root only): all workspaces (create,
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
4. **Privileges screen for the audit** (`/settings/permissions`, root and
   admins read-only): the matrix above generated from the code (one source:
   a `CAPABILITIES` table in `constants.ts` that the functions read), plus per
   member: role, Page scope, last sign-in, recent actions. Exportable CSV.
5. **Custom role tweaks** only after the owner's audit — don't change the
   matrix before the owner has reviewed it.
6. Tests: first sign-up race (two at once → one root); invited "owner" is not
   root; non-root gets 403 on every `/api/settings/config` and root console
   route; capability table matches the functions.
