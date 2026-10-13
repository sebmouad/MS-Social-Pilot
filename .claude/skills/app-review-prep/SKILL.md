---
name: app-review-prep
description: Check MS Social Pilot's readiness for Meta App Review and prepare a submission — use cases, screencast scripts, reviewer instructions, test account.
---

# Meta App Review preparation

1. Status first: DevTools MCP `devtools_app_review` with `status`, `privileges`,
   `requirements` for app 699780715171676. Only one submission can be pending.
2. Material: `docs/META_API_NOTES.md` (App Review section: submissions,
   step-2 permissions and use cases). Write reviewer instructions for the
   current UI (Workspace › Channels, New post, Inbox, Analytics).
3. For each permission: a use case that names the screen, a screencast script
   (login dialog showing the permission → the feature using it → the result on
   Facebook), and a reviewer step. Claims must match the code — verify each feature
   live before writing it down.
4. Prerequisites: privacy policy, terms and data deletion URLs live
   (`/privacy-policy`, `/terms`, `/data-deletion`), business verification done,
   app icon, feature switches on for the permissions being recorded.
5. The owner records the videos and submits; the agent never submits forms on
   Meta without explicit approval for that action. Test account:
   meta-review@newsgeet.com (password typed by the owner only).
6. After approval: Live mode, switch features on in Configuration, reconnect.
