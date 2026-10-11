---
name: live-facebook-test
description: Test MS Social Pilot against real Facebook in the owner's Chrome — publishing, scheduling, first comments, comments moderation, insights accuracy — safely on the sandbox Page.
---

# Live Facebook test (real browser, real data)

Requires the owner's explicit OK for any action that publishes, deletes or
messages. Agreed sandbox: **DIY Page 3** (1 follower).

1. Connections → tick DIY Page 3 (Active). Verify the click took (first clicks
   after navigation are sometimes lost).
2. Run the scenarios through the UI (Claude in Chrome tools), checking each on
   facebook.com:
   - Publish now with a first comment → post + comment as the Page.
   - Photo with alt text scheduled 2–3 min ahead (app worker) → published on time
     (`journalctl -u social-pilot-worker` shows `[publish] Published post …`).
     Use `date -u` on your machine for the time — the browser clock may differ.
   - Link post held by Facebook (≥ 10 min ahead) → Cancel → gone on Facebook.
   - Analytics → Comments → Pull → Reply as the Page → Delete (Hide is refused by
     Facebook for the Page's own comments).
   - Compare a busy Page's numbers (followers, reactions, comments, shares,
     engagement rate) with Facebook after "Pull from Facebook".
3. Clean up: Posts → each test post → **Delete from Facebook**; confirm the old
   URLs say "Ce contenu n'est pas disponible".
4. Connections → untick DIY Page 3 (Paused).
5. Write findings into `docs/ai/TESTING.md` (live log) and fix bugs found.
Test image: create one locally (e.g. Playwright screenshot of a gradient) inside
the session folder and upload with the Chrome `file_upload` tool.
