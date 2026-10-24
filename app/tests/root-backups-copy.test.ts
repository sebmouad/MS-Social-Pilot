import { describe, expect, it } from 'vitest';
import { ROOT_BACKUPS_COPY, backupsCopyText } from '../src/lib/config/root-backups-copy';
import { ROOT_OPERATIONS_COPY } from '../src/lib/config/root-operations-copy';

describe('Root operations and backup copy catalogs', () => {
  it('provides complete defaults for the page metadata and headings', () => {
    expect(ROOT_OPERATIONS_COPY).toMatchObject({ metadataTitle: expect.any(String), eyebrow: expect.any(String), title: expect.any(String), intro: expect.any(String) });
    expect(ROOT_BACKUPS_COPY).toMatchObject({ metadataTitle: expect.any(String), eyebrow: expect.any(String), title: expect.any(String), intro: expect.any(String) });
  });

  it('interpolates named backup status values as plain text and leaves unknown tokens intact', () => {
    expect(backupsCopyText(ROOT_BACKUPS_COPY.lastSuccess, { time: '<time>', age: 3 })).toBe('Last success <time> (3 h ago)');
    expect(backupsCopyText('{count} {unknown}', { count: 2 })).toBe('2 {unknown}');
  });
});
