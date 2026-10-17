import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('../prisma/migrations/20261017030000_rebuild_facebook_media_deletions/migration.sql', 'utf8');

describe('Facebook staged-photo deletion journal migration', () => {
  it('adds only a content-free workspace-owned journal with immutable bindings', () => {
    expect(migration.match(/CREATE TABLE /g)).toHaveLength(1);
    expect(migration).toContain('CREATE TABLE rebuild_facebook_media_deletions');
    expect(migration).toContain('REFERENCES workspaces(id) ON DELETE CASCADE');
    expect(migration).not.toMatch(/REFERENCES (targets|posts|post_targets|users|rebuild_publication_attempts)/);
    expect(migration).toMatch(/state text NOT NULL DEFAULT 'started'/);
    expect(migration).toContain("state IN ('started', 'uncertain', 'confirmed', 'rejected')");
    expect(migration).toContain('IS TRUE');
    expect(migration).toContain('rebuild_facebook_media_deletions_binding_immutable_trigger');
    expect(migration).not.toMatch(/accessToken|refreshToken|mediaBytes|mediaUrl|rawResponse|providerError|postText/i);
    expect(migration).not.toMatch(/\b(?:ALTER|DROP|TRUNCATE)\s+TABLE\b/i);
  });

  it('keeps unresolved and confirmed photo identities unique while allowing explicit rejected retries', () => {
    expect(migration).toContain('ON rebuild_facebook_media_deletions ("workspaceId", "mediaStepId")');
    expect(migration).toContain('WHERE state <> \'rejected\'');
  });
});
