import { describe, expect, it } from 'vitest';
import { portableWorkspaceFiles } from '@/server/data-control/portable-files';

const fixture = {
  targets: [{ id: 'channel-a', name: 'Café Lumière', insights: [{ metric: 'views', period: 'day', endTime: '2026-10-21T00:00:00.000Z', value: { total: 42 } }], postTargets: [{ postId: 'post-a', comments: [{ remoteId: 'remote-comment', message: 'Merci' }] }] }],
  posts: [
    { id: 'post-a', message: '=IMPORTXML("https://example.test")', status: 'published', firstComment: 'First', targets: [{ targetId: 'channel-a', status: 'published', publishedAt: '2026-10-21T09:00:00.000Z', remoteUrl: 'https://example.test/post-a' }] },
    { id: 'draft-a', message: 'Two\nlines, "quoted"', status: 'draft', targets: [] },
  ],
  legacyTables: { queue_slots: [{ targetId: 'channel-a', dayOfWeek: 1, hour: 9, minute: 0 }], labels: [{ id: 'label-a', name: 'Launch' }] },
  indirectTables: { post_labels: [{ postId: 'post-a', labelId: 'label-a' }] },
};

describe('portable owner ZIP files', () => {
  it('retains destinations, labels, first comments and destinationless drafts in UTF-8 CSV', () => {
    const csv = portableWorkspaceFiles(fixture)['posts.csv']!;
    expect(csv).toContain('first_comment');
    expect(csv).toContain('Café Lumière');
    expect(csv).toContain('Launch');
    expect(csv).toContain('First');
    expect(csv).toContain("\"'=IMPORTXML(\"\"https://example.test\"\")\"");
    expect(csv).toContain('"Two\nlines, ""quoted"""');
    expect(csv).toContain('draft-a');
    expect(csv.split('\r\n')).toHaveLength(4);
  });

  it('keeps stored insight objects, schedule and comments with neutral channel identities', () => {
    const files = portableWorkspaceFiles(fixture);
    expect(files['analytics/channels.csv']).toContain('views');
    expect(files['analytics/channels.csv']).toContain('"{""total"":42}"');
    expect(JSON.parse(files['schedule.json']!)).toEqual([{ targetId: 'channel-a', dayOfWeek: 1, hour: 9, minute: 0 }]);
    expect(JSON.parse(files['comments.json']!)[0]).toMatchObject({ postId: 'post-a', channelId: 'channel-a', message: 'Merci' });
    expect(JSON.parse(files['channels.json']!)[0]).toMatchObject({ id: 'channel-a', name: 'Café Lumière' });
  });

  it('does not mutate source data and exports headers for empty datasets', () => {
    const before = structuredClone(fixture);
    portableWorkspaceFiles(fixture);
    expect(fixture).toEqual(before);
    const empty = portableWorkspaceFiles({});
    expect(empty['posts.csv']).toMatch(/^post_id,/);
    expect(empty['analytics/channels.csv']).toMatch(/^channel_id,/);
    expect(JSON.parse(empty['schedule.json']!)).toEqual([]);
  });

  it('neutralizes spreadsheet formulas, including leading whitespace and control prefixes', () => {
    for (const message of ['+SUM(A1)', '-1+2', '@SUM(A1)', '\t=1', ' \r=1']) {
      expect(portableWorkspaceFiles({ posts: [{ id: 'p', message }] })['posts.csv']).toContain(`"'${message}"`);
    }
  });
});
