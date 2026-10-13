# Root, roles and privileges

This file is for the owner's audit. It describes what the code enforces today;
keep it true whenever a check changes, and do not widen or change a privilege
without the owner's review.

## Root (installation owner)

- **Who**: the first account ever created. `registerUser()` in `src/lib/auth.ts`
  sets `isInstanceOwner` inside a transaction with an advisory lock, so two
  simultaneous first sign-ups cannot both become root. Nobody else gets it,
  whatever their workspace role: a workspace owner is not root.
- **Check**: `canManageInstance(auth)` in `src/lib/constants.ts`.
- **Own section**: everything root does lives under `/root/*`
  (`src/app/(root)/root/`), with its own sidebar, a persistent banner ("changes
  affect the whole installation") and "Back to the app". The entry is a Root
  item in the account menu, shown to root only. `requireRoot()` (pages) and
  `requireRootApi()` (`/api/root/*`) answer **404** to everybody else, signed
  out included, so the section is not advertised; e2e and
  `tests/api-routes.integration.test.ts` check it.
- **Root-only areas**:
  - **Settings**: site address, AI providers, storage, email, security,
    general (`/root/config/[section]`; `/root/config` opens the first one),
    Plans, Sign-ups and invitations. The old `/settings/config` redirects root
    there and is 404 for others; `/api/settings/config*` re-export the
    `/api/root/config*` handlers.
  - **Platforms**: Meta (app settings, redirect and webhook addresses, feature
    switches, API usage, Facebook and Instagram connections) and one page per
    other network (switch, credentials, connections).
  - **Connections and token health**: `/root/connections` lists every channel
    of every workspace grouped by platform with problem counts; the connection
    check runs at `/api/root/connections/health`, and `GET /api/accounts/[id]`
    (raw platform errors and granted scopes) answers 404 to signed-in non-root
    members. Workspace members see only "Connected" or "Needs reconnecting"
    with Reconnect, and what a connection can do in plain words
    (`src/lib/scope-abilities.ts`), never Meta's permission names.
  - People: workspaces, users, agency overview, privileges matrix, sessions.
  - Health: status, worker and Meta usage, errors, alerts, backups.
  - History: root activity, changelog. Danger zone: transfer root.
  - The setup wizard and checklist (`mayChangeSetup` in `src/lib/setup.ts`) and
    the setup card on the dashboard.
- **Separate log**: every root action is written to `RootActivity`, shown only
  in the root section.
- **Registration after root**: invitation only, unless root turns on open
  registration (`admission()` in `src/lib/auth.ts`).

### What root can do to workspaces and people

- **Modules** (`src/lib/modules.ts`: analytics, ads, schedule): switched off per
  workspace (`Workspace.disabledModules`) or per member
  (`Membership.disabledModules`). What a member may use is
  `enabledModules(workspace, member)`. Switched-off modules have no links,
  their screens 404 and their API routes answer 403 (the path comes from
  `src/middleware.ts`, matched by `moduleOfPath()`). Shared screens (dashboard,
  channels, settings) belong to no module.
- **Developer features** (API keys, MCP, the Claude web connector, outgoing
  webhooks and their log): off for every workspace by default
  (`Workspace.developerFeatures`); root switches them on per workspace. When on,
  only root sees and manages them (`mayUseDeveloperFeatures`; screens 404, APIs
  403); workspace owners included do not. Switching off stops existing keys and
  queues no more deliveries; nothing is deleted. `/oauth/authorize` and
  `/api/oauth/authorize` follow the same rule; `/api/oauth/register` and
  `/api/oauth/token` need no session but grant nothing alone (client id, and a
  one-time code with its PKCE verifier).
- **Suspend / resume a workspace** (`Workspace.suspendedAt`): members see a
  notice, API calls answer 403, the scheduler holds its posts. Root still gets in.
- **Open any workspace as its owner** (`POST /api/root/workspaces/[id]/visit`,
  cookie honoured only for root): amber banner with "Leave workspace", each
  visit logged.
- **Members** (`/root/workspaces/[id]`): add an existing account with a role,
  change a role, switch modules off for one person, remove. A workspace always
  keeps an owner.
- **Create and delete** (`src/lib/root.ts`): create a workspace for any account
  (it becomes owner), delete a workspace with everything in it, delete any
  account except root's own. An account that is the only owner of a workspace
  cannot be deleted until the workspace has another owner or is gone; its
  posts stay, credited to root.
- **Users**: disable / enable (`User.disabledAt`: sessions deleted, sign-in
  refused; root cannot be disabled), sign out everywhere, reset someone's
  second step. **Sessions** (`/root/sessions`): every signed-in browser on the
  installation; root can end any one. A person ends only their own
  (`DELETE /api/account/sessions/[id]`).
- **Client invitations**: root invites a client to create their own workspace
  (`ClientInvitation`, 14 days, optional suggested name). Only that address is
  admitted; registering creates an isolated workspace with them as owner.
- **Plans** (`/root/plans`, `src/lib/plans.ts`): prices, limits (channels, team
  members, workspaces, posts and AI credits a month) and features (`api`,
  `clients`, `whiteLabel`). Root puts each subscriber (a user who owns a
  workspace) on a plan and can grant extra channels. Limits count across every
  workspace the subscriber owns and are enforced on new workspaces, team
  invitations (clients are free), new channels, posts and AI calls (402
  `errors.planLimit_*`, `errors.planFeature_*`). Root and users without a plan
  have no limits. No payment provider yet.
- **Transfer root**: confirmed with root's password, both people emailed. If root
  is lost, `scripts/admin/set-root.ts` over SSH (see OPERATIONS.md); no web back door.

## Workspace roles

Order (`src/lib/constants.ts`): owner 4 > admin 3 > editor 2 > contributor 1 >
viewer 0 = client 0. Names shown in the app: owner = **Agency owner**, admin =
**Admin**, editor = **Manager**, contributor = **Creator**, viewer = **Viewer**,
client = **Client**; the code keeps the enum values. `CAPABILITIES` in
`constants.ts` is the single table the `can…` functions read; it is printed at
`/root/privileges` (with every member's role, Page access, last sign-in, CSV
export). Settings › Permissions shows the same for one workspace, to root only.

| Capability (function) | Minimum role |
|---|---|
| Connect / remove Pages and accounts, remove one Page (`canManageAccounts`) | admin |
| Invite, change roles, Page access per member (`canManageTeam`) | admin |
| Workspace settings incl. key dates, seasonal modes, content mix, Page goals (`canManageSettings`) | admin |
| Approve / reject posts (`canApprove`) | admin, or client |
| Delete comments (`canDeleteComments`) | admin |
| Reply to / hide comments, moderation rules (`canModerateComments`) | editor |
| Publish without approval (`canPublishWithoutApproval`) | editor |
| Edit or delete other people's posts (`canManageOthersPosts`) | editor |
| Delete media (`canDeleteMedia`) | editor |
| Manage post templates (`canManageTemplates`; using one needs no role) | editor |
| Add or remove chart notes (members limited to some Pages note only those, never "every Page") | editor |
| Version history of a post: its author, or `canManageOthersPosts` | contributor (own posts) |
| Read and add internal notes on a post they can see; remove: author or `canManageOthersPosts` | contributor |
| Own calendar feeds (show only the Pages the member may see when read) | contributor |
| Compose drafts (`canCompose`) | contributor |
| Export everything as a ZIP (`/settings/export`; never tokens, 7-day link, logged) | owner only |
| Agency screen (`/agency`): give people already on one of their workspaces a role in another they own; never owners or clients; same rules and seat limits as Team | owner |

Other rules:

- Marking an inbox item done / not done, and assigning it: any member who can
  see the Page. It changes only the team's shared state, never Facebook.
- Moderation rules: a member limited to some Pages sees and edits only rules
  that name only their Pages and cannot write an "every Page" rule.
- Notifications about one Page go only to members who may see it and did not
  mute it. The "nothing scheduled" email goes to owners, admins and editors;
  "your post was changed" to the post's author.
- **Client step after the team**: with approval on, an owner or admin can turn
  on "Then ask the client"; the team's approval is recorded and the post waits
  for the client's answer through a review link. No role gains a privilege.

### Viewer

Reads everything in its channels and changes nothing. Every signed-in API write
is refused in `requireAuth` (`mayWrite` in `src/lib/role-access.ts`, 403
`errors.viewerReadOnly`) except its own things: `/api/account`, `/api/auth`,
`/api/notifications`, `/api/calendar-feeds`, `/api/exports`. No composer; the
screens that only change things are hidden.

### Client

The agency's customer. Only capability: `approve` (`CLIENT_CAPABILITIES`):
approve or reject posts and add notes on them. Screens (`mayOpenScreen`):
calendar, posts, approvals, own account and notifications. Each workspace may
open more on Settings › Team (`Workspace.clientAccess`): `analytics` (read
only, the default), `inbox` (read only) and `library` (media, uploads allowed).
Never settings, team, channels, API or anything technical. API writes: own
things as for the viewer, plus `/api/posts/:id/approve`, `/api/posts/:id/notes`
and `/api/media` with the library switch; everything else 403. A client cannot
be promoted and a team member cannot be made a client (`changeRole`, 409);
root can still change any role. Clients get no approval emails.

### Page scope

Every non-admin member can be limited to some Pages (`MemberPageAccess`,
`auth.pageScope`), applied by `loadPageFilter` and the scope helpers in
`src/lib/page-access.ts`. Every action is recorded in `ActivityLog`
(Settings › History, admins).

## Workspace isolation

Each workspace is one client: its own data and team; nobody in another
workspace can see or touch it, owners included. Every query filters on the
workspace and the Page scope. `tests/tenant-isolation.integration.test.ts`
calls every `[id]` route as another workspace's owner with real ids (must answer
404/403 and change nothing), every list route, and bodies naming foreign Pages.
A new `[id]` route fails that test until it is mapped. Signed-in API calls also
count against a per-workspace request budget (429 when exceeded).

## Two kinds of invitation

- **Join a workspace**: an owner or admin invites from Settings › Team
  (`Invitation`, role chosen there).
- **Create their own workspace**: root invites from Root › Sign-ups
  (`ClientInvitation`).

## Open for the owner's audit

- Custom role tweaks: none until the matrix above is reviewed.
- A "connect own Pages" switch for clients is not built (connecting goes
  through `canManageAccounts` and would also have to extend the client's access).
- Visibility levels for client spaces are not built (see PLAN.md).
