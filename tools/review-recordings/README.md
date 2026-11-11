# Meta App Review recordings

Playwright scripts that record the app part of each App Review video on the live site: 1920×1080, the sign-in shown,
a caption naming the permission, and a red box and dot on every click. Output is H.264 mp4 next to the scripts.

Run from this folder with `SP_URL`, `SP_USER`, `SP_PASSWORD` set (never printed): `node v01.js`.
Needs Playwright (pre-installed in the cloud container) and ffmpeg.

- `v06.js` publishes a real post and `v07.js` replies to, hides and shows a real comment: run them only on purpose.
  `v06b.js` records the ending of v06 (signed in out of view) without publishing again.
- `record(name, perm, script, { signIn: false, start })` makes a continuation clip.

Recorded on 2026-11-11: pages_show_list, business_management, pages_read_engagement, read_insights,
pages_read_user_content, pages_manage_posts, pages_manage_engagement.
