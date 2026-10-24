import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({
  deleteNotification: vi.fn(),
  listNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  readNotificationPreferences: vi.fn(),
  updateNotificationPreferences: vi.fn(),
}));

vi.mock('@/modules/settings/notifications/server', () => service);

import { executeNotificationTool, notificationToolDefinitions, notificationTools, notificationWriteTools } from '@/modules/settings/notifications/mcp';
import { notificationConfirmation } from '@/modules/settings/notifications/contracts';

const actor = { userId: 'member-a', workspaceId: 'workspace-a' };

describe('notification MCP surface', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exposes scoped reads and exact-confirmation writes, with only writes classified as writes', () => {
    expect([...notificationTools]).toEqual([
      'get_notification_preferences', 'update_notification_preferences', 'list_notifications', 'mark_notification_read', 'delete_notification',
    ]);
    expect([...notificationWriteTools]).toEqual(['update_notification_preferences', 'mark_notification_read', 'delete_notification']);
    expect(notificationToolDefinitions.every(tool => tool.inputSchema.additionalProperties === false)).toBe(true);
    expect(notificationToolDefinitions.find(tool => tool.name === 'mark_notification_read')?.description).toContain('READ NOTIFICATION <id>');
    expect(notificationToolDefinitions.find(tool => tool.name === 'delete_notification')?.description).toContain('DELETE NOTIFICATION <id>');
  });

  it('advertises the service ceiling while leaving current Root bounds to the service', () => {
    const update = notificationToolDefinitions.find(tool => tool.name === 'update_notification_preferences')!;
    expect((update.inputSchema.properties as { mutes: { maxItems: number } }).mutes.maxItems).toBe(5000);
  });

  it('routes personal reads and writes with only the authenticated workspace actor', async () => {
    service.readNotificationPreferences.mockResolvedValue({ preferences: {} });
    service.listNotifications.mockResolvedValue({ items: [], page: 1, pageSize: 20, hasMore: false });
    service.updateNotificationPreferences.mockResolvedValue({ preferences: {} });
    service.markNotificationRead.mockResolvedValue({ id: 'notice-a', read: true });
    service.deleteNotification.mockResolvedValue({ id: 'notice-a', deleted: true });

    await executeNotificationTool(actor, 'get_notification_preferences', {});
    await executeNotificationTool(actor, 'list_notifications', { page: 2, unreadOnly: true });
    await executeNotificationTool(actor, 'update_notification_preferences', { onNoteMention: false, confirmation: 'UPDATE NOTIFICATION PREFERENCES' });
    await executeNotificationTool(actor, 'mark_notification_read', { id: 'notice-a', confirmation: notificationConfirmation.read('notice-a') });
    await executeNotificationTool(actor, 'delete_notification', { id: 'notice-a', confirmation: notificationConfirmation.delete('notice-a') });

    expect(service.readNotificationPreferences).toHaveBeenCalledWith(actor);
    expect(service.listNotifications).toHaveBeenCalledWith(actor, { page: 2, unreadOnly: true });
    expect(service.updateNotificationPreferences).toHaveBeenCalledWith(actor, { onNoteMention: false, confirmation: 'UPDATE NOTIFICATION PREFERENCES' });
    expect(service.markNotificationRead).toHaveBeenCalledWith(actor, { id: 'notice-a', confirmation: notificationConfirmation.read('notice-a') });
    expect(service.deleteNotification).toHaveBeenCalledWith(actor, { id: 'notice-a', confirmation: notificationConfirmation.delete('notice-a') });
  });

  it('rejects mismatched read and delete confirmations before calling the service', async () => {
    await expect(executeNotificationTool(actor, 'mark_notification_read', { id: 'notice-a', confirmation: 'READ NOTIFICATION notice-b' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(executeNotificationTool(actor, 'delete_notification', { id: 'notice-a', confirmation: 'DELETE NOTIFICATION notice-b' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(service.markNotificationRead).not.toHaveBeenCalled();
    expect(service.deleteNotification).not.toHaveBeenCalled();
  });
});
