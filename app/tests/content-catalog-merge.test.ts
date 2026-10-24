import { describe, expect, it } from 'vitest';
import { contentCopyDefaults, contentPolicyDefaults, resolveContentCatalog, resolveContentCopy, resolveContentPolicy } from '../src/modules/publishing/ui/content-copy';

describe('content catalog merge (UI wave 2)', () => {
  it('ships English and French text for the wave-2 keys with matching placeholders', () => {
    const keys = Object.keys(contentCopyDefaults).filter(key =>
      key.startsWith('createPreview') || key.startsWith('calendarView') || key.startsWith('calendarWeek') || key.startsWith('calendarLanes') || key.startsWith('calendarNo') || key.startsWith('calendarLane') || key.startsWith('calendarQuiet') || key.startsWith('calendarCap') || key.startsWith('approvalsStage') || key.startsWith('approvalsDraft') || key.startsWith('approvalsReview') || key.startsWith('approvalsApproved') || key.startsWith('approvalsScheduled') || key.startsWith('approvalsView') || key.startsWith('approvalsOpen') || key.startsWith('approvalsNotes') || key.startsWith('approvalsBoard'));
    expect(keys.length).toBeGreaterThan(20);
    const placeholders = (text: string) => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort().join();
    for (const key of keys) {
      const message = contentCopyDefaults[key as keyof typeof contentCopyDefaults];
      expect(message.en.length, key).toBeGreaterThan(0);
      expect(message.fr.length, key).toBeGreaterThan(0);
      expect(placeholders(message.fr), key).toBe(placeholders(message.en));
    }
  });
  it('gives catalogs saved before wave 2 the new keys without losing operator edits', () => {
    const { createPreviewAll: _dropped, calendarViewList: _dropped2, approvalsStageDraft: _dropped3, approvalsApprovedBy: _dropped4, ...rest } = contentCopyDefaults;
    void _dropped; void _dropped2; void _dropped3; void _dropped4;
    const saved = { ...rest, createTitle: { en: 'Operator title', fr: 'Titre opérateur' }, obsoleteKey: { en: 'old', fr: 'vieux' } };
    const merged = resolveContentCatalog(saved);
    expect(merged.createTitle).toEqual({ en: 'Operator title', fr: 'Titre opérateur' });
    expect(merged.createPreviewAll).toEqual(contentCopyDefaults.createPreviewAll);
    expect(merged.calendarViewList).toEqual(contentCopyDefaults.calendarViewList);
    expect(merged.approvalsStageDraft).toEqual(contentCopyDefaults.approvalsStageDraft);
    expect('obsoleteKey' in merged).toBe(false);
    const resolved = resolveContentCopy(merged, 'fr');
    expect(resolved.createTitle).toBe('Titre opérateur');
    expect(resolved.createPreviewAll).toBe(contentCopyDefaults.createPreviewAll.fr);
  });
  it('falls back to shipped text for a saved message that drops a placeholder', () => {
    const merged = resolveContentCatalog({ ...contentCopyDefaults, createChannelsSelected: { en: 'picked', fr: 'choisis' } });
    expect(merged.createChannelsSelected).toEqual(contentCopyDefaults.createChannelsSelected);
  });
  it('merges the behaviour policy per field, defaulting the pipeline stage cap', () => {
    expect(contentPolicyDefaults.pipelinePerStage).toBe(6);
    expect(resolveContentPolicy({ ...contentPolicyDefaults, pipelinePerStage: 4, monthPostsShown: 99 })).toEqual({ ...contentPolicyDefaults, pipelinePerStage: 4 });
    expect(resolveContentPolicy(undefined)).toEqual(contentPolicyDefaults);
    const { pipelinePerStage: _dropped, ...old } = contentPolicyDefaults;
    void _dropped;
    expect(resolveContentPolicy(old)).toEqual(contentPolicyDefaults);
  });
});
