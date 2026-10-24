import { describe, expect, it } from 'vitest';
import { sanitizeRootActivity } from '../src/server/root/read-model';

describe('Root activity read model', () => {
  it('only exposes allowlisted metadata and never returns raw audit detail', () => {
    const activity = sanitizeRootActivity({
      id: 'a1', action: 'publishing.posts_imported', createdAt: new Date('2026-10-16T12:00:00Z'),
      actorName: 'Operator', actorEmail: 'operator@example.test',
      detail: { postCount: 3, targetCount: 4, accessToken: 'secret', password: 'secret', message: 'private text', workspaceId: 'ws_123' },
    });
    expect(activity).toEqual({
      id: 'a1', action: 'publishing.posts_imported', createdAt: new Date('2026-10-16T12:00:00Z'),
      actor: { name: 'Operator', email: 'operator@example.test' }, metadata: ['3 posts', '4 destinations'],
    });
    expect(JSON.stringify(activity)).not.toMatch(/secret|private text|ws_123/);
  });

});
