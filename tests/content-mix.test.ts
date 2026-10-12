import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { effectiveMix } from '@/lib/content-mix';

const rule = (fields: { targetId?: string; groupId?: string; labelId: string; perWeek: number }) => ({
  id: `${fields.targetId ?? fields.groupId}-${fields.labelId}`,
  targetId: fields.targetId ?? null,
  groupId: fields.groupId ?? null,
  labelId: fields.labelId,
  perWeek: fields.perWeek,
  dryNotifiedAt: null,
});

describe('effectiveMix', () => {
  const groupsOf = new Map([
    ['page-a', ['group-1']],
    ['page-b', ['group-1', 'group-2']],
    ['page-c', []],
  ]);

  it('gives each Page in a group the group’s mix', () => {
    const mixes = effectiveMix([rule({ groupId: 'group-1', labelId: 'product', perWeek: 4 })], ['page-a', 'page-b', 'page-c'], groupsOf);
    expect(mixes.get('page-a')?.get('product')?.perWeek).toBe(4);
    expect(mixes.get('page-b')?.get('product')?.perWeek).toBe(4);
    expect(mixes.has('page-c')).toBe(false);
  });

  it('lets a Page’s own mix replace its groups’ mix entirely', () => {
    const mixes = effectiveMix(
      [rule({ groupId: 'group-1', labelId: 'product', perWeek: 4 }), rule({ targetId: 'page-a', labelId: 'tip', perWeek: 2 })],
      ['page-a'],
      groupsOf,
    );
    expect([...mixes.get('page-a')!.keys()]).toEqual(['tip']);
  });

  it('takes the larger number when two groups ask for the same label', () => {
    const mixes = effectiveMix(
      [
        rule({ groupId: 'group-1', labelId: 'product', perWeek: 2 }),
        rule({ groupId: 'group-2', labelId: 'product', perWeek: 5 }),
        rule({ groupId: 'group-2', labelId: 'tip', perWeek: 1 }),
      ],
      ['page-b'],
      groupsOf,
    );
    const mix = mixes.get('page-b')!;
    expect(mix.get('product')?.perWeek).toBe(5);
    expect(mix.get('product')?.rules).toHaveLength(2);
    expect(mix.get('tip')?.perWeek).toBe(1);
  });
});
