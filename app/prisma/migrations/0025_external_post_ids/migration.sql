-- One post, two ids (2026-11-22): a Page with a new-style profile lists its posts as « profileId_postId » in its feed,
-- while publishing returned « pageId_postId ». The feed copies take the app's id, so they join their post everywhere.
-- A feed copy already stored under the app's id wins; the other one is removed first. Ids without « _ » never match
-- (split_part gives '' for them).
DELETE FROM "external_posts" e
USING "post_targets" pt, "external_posts" kept
WHERE pt."targetId" = e."targetId" AND pt."remotePostId" IS NOT NULL
  AND split_part(pt."remotePostId", '_', 2) <> '' AND split_part(pt."remotePostId", '_', 2) = split_part(e."remoteId", '_', 2) AND e."remoteId" <> pt."remotePostId"
  AND kept."targetId" = e."targetId" AND kept."remoteId" = pt."remotePostId";
UPDATE "external_posts" e SET "remoteId" = pt."remotePostId"
FROM "post_targets" pt
WHERE pt."targetId" = e."targetId" AND pt."remotePostId" IS NOT NULL
  AND split_part(pt."remotePostId", '_', 2) <> '' AND split_part(pt."remotePostId", '_', 2) = split_part(e."remoteId", '_', 2) AND e."remoteId" <> pt."remotePostId";
