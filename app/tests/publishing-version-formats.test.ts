import { describe, expect, it } from 'vitest';
import { recordPostVersion } from '../src/modules/publishing/collaboration/server/versions';

describe('per-destination format snapshots', () => {
  it('stores each target format with the post format as the legacy fallback', async () => {
    const statements: string[] = [];
    const tx = {
      $executeRaw: async (strings: TemplateStringsArray) => {
        statements.push(strings.join('?'));
        return 1;
      },
    };

    await expect(recordPostVersion(tx as never, 'post-1', 'user-1', 20)).resolves.toBe(true);

    const insert = statements[0];
    expect(insert).toContain('"destinationFormats"');
    expect(insert).toContain('jsonb_object_agg(t."targetId", COALESCE(t."formatId", p.format))');
    expect(insert).toContain("'{}'::jsonb");
    expect(insert).toContain('FROM post_targets t WHERE t."postId" = p.id');
    expect(insert).toContain('FROM posts p WHERE p.id = ?');
  });

  it('includes destination formats in the duplicate-snapshot comparison', async () => {
    const statements: string[] = [];
    const tx = {
      $executeRaw: async (strings: TemplateStringsArray) => {
        statements.push(strings.join('?'));
        return 0;
      },
    };

    await expect(recordPostVersion(tx as never, 'post-1', null, 20)).resolves.toBe(false);

    expect(statements[0]).toContain('prev."destinationFormats" IS NOT DISTINCT FROM COALESCE');
    expect(statements[0]).toContain('jsonb_object_agg(t."targetId", COALESCE(t."formatId", p.format))');
  });
});
