-- A click is one visitor arriving, not one page load. Recording one now asks
-- whether the same visitor already followed this link a moment ago, and this
-- index is what makes that question cheap.
CREATE INDEX "link_clicks_shortLinkId_ipHash_createdAt_idx"
  ON "link_clicks"("shortLinkId", "ipHash", "createdAt");
