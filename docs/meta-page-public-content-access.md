# Meta « Page Public Content Access »: request draft (prepared 20 Nov 2026, not sent)

Submit **only after the current App Review is approved**, as a separate request, so the two reviews do not mix.

## What the feature gives

- Read the public posts of Facebook Pages the app does not manage: `GET /{page-id}/posts` (or `/feed`).
- Per post: `message`, `full_picture`, `created_time`, `permalink_url`, `shares`, `reactions.summary(true)`,
  `comments.summary(true)`. **Not** reach or impressions (those stay private to each Page).
- Limits stated by Meta: about 600 ranked posts per year per Page, at most 100 per request; use a system user token to
  avoid rate limits. During development it only works for Pages whose admin has a role on the app.

## Prerequisites

1. Business Verification of the business that owns the app (5–15 working days per cycle).
2. The current App Review approved.
3. A system user in Business Manager with a token for the app.

## Use case text (for the review form)

> MS Social Pilot is a publishing tool for a group of French home-cooking Facebook Pages. The owner lists a small number
> of public French recipe Pages they follow as competitors. Once a day the app reads those Pages' recent public posts
> (text, photo, publish time, and public counts of reactions, comments and shares) to show the owner which recipes and
> which kinds of food photos get the most engagement in their market, and to help choose which of their own recipes to
> publish. Data is shown only to the workspace owner, is never re-published, never used to target or contact people, and
> posts older than 90 days are deleted. No personal data of commenters or reactors is read: only the counts.

## Screencast plan (what the reviewer must see)

1. Sign in as the workspace owner; open Content → Competitors.
2. Add a public French recipe Page by its link; the app shows its name and picture.
3. Show the daily list of its recent posts with photo, time and reaction/comment/share counts, ranked by shares.
4. Show how a recipe that matches a top competitor dish is boosted in the autopilot's choice (one line: « matches a
   market hit »).
5. Remove the competitor Page; its stored posts are deleted.

## First competitors to read (owner, 22 Nov 2026)

- https://www.facebook.com/magickitchen038
- https://www.facebook.com/cookikitchen1
- https://www.facebook.com/mabonnerecette92

All three are behind Facebook's login on the web; no public copy or search index has them. Owner's choice: wait for this
permission rather than screenshots or a swipe file.

## How the app would use it (to build after approval)

- `competitor_pages` (owner-managed list) and `competitor_posts` (90-day retention).
- Daily job: read each listed Page's new posts; rank by shares and reactions relative to the Page's follower count.
- The photo of each top post is rated with the same rules as our own (`PHOTO_VERSION`), and its dish words feed a
  « market hits » signal next to our own `hitWords` (see AGENT.md 7.1m).
- Until then, the same signal can come from a manual swipe file (owner pastes links or photos with visible counts).

## Data handling

- Only public Page content; no user-level data.
- Retention 90 days; deletion when a competitor Page is removed.
- Shown only to members of the workspace.
