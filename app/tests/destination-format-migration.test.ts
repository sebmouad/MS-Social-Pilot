import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASELINE_NAME, BASELINE_SHA256, baselineBlock } from './baseline-block';

const deploy = readFileSync('scripts/deploy.sh', 'utf8');
const migration = baselineBlock('20261019020000_rebuild_destination_formats');

describe('destination format migration guards', () => {
  it('ships inside the pinned baseline verified by deploy.sh', () => {
    expect(deploy).toContain(`BASELINE=${BASELINE_NAME}`);
    expect(deploy).toContain(`BASELINE_SHA256=${BASELINE_SHA256}`);
    expect(migration).toContain('ALTER TABLE post_targets ADD COLUMN "formatId" text');
    expect(migration).toContain('char_length("formatId") BETWEEN 1 AND 128');
    expect(migration).toContain('ALTER TABLE post_versions ADD COLUMN "destinationFormats" jsonb NOT NULL DEFAULT');
    expect(migration).toContain('CHECK (jsonb_typeof("destinationFormats") = \'object\')');
    expect(migration).not.toMatch(/DROP\s+(COLUMN|TABLE)|UPDATE\s+(posts|post_targets|post_versions)/i);
  });

  it('releases through deploy.sh with baseline resolve handling', () => {
    expect(deploy).toContain('BASELINE=20261103000000_baseline');
    expect(deploy).toContain('marked applied (');
    expect(deploy).toContain('DEPLOY OK');
  });
});
