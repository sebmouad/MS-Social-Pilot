import { OperationError } from '@/lib/operation-error';
import type { NotificationActor } from './contracts';
import { notificationConfirmation, NOTIFICATION_EVENTS } from './contracts';
import {
  deleteNotification, listNotifications, markNotificationRead,
  readNotificationPreferences, updateNotificationPreferences,
} from './server';

const id = { type: 'string', minLength: 1, maxLength: 200 } as const;
const confirmation = { type: 'string', description: 'Exact confirmation text named in the tool description.' } as const;
const object = (properties: object, required: string[] = []) => ({ type: 'object', required, properties, additionalProperties: false }) as const;

export const notificationToolDefinitions = [
  { name: 'get_notification_preferences', description: 'Read your notification email choices and muted channel alerts in this workspace.', inputSchema: object({}) },
  { name: 'update_notification_preferences', description: 'Update your own notification email choices and replace your muted channel alerts. Confirmation must exactly match UPDATE NOTIFICATION PREFERENCES.', inputSchema: object({ onNoteMention: { type: 'boolean' }, onQueueEmpty: { type: 'boolean' }, mutes: { type: 'array', maxItems: 5000, items: object({ targetId: id, event: { type: 'string', enum: ['queueEmpty'] } }, ['targetId', 'event']) }, confirmation }, ['confirmation']) },
  { name: 'list_notifications', description: 'List your notifications in this workspace, newest first. Results include delivery state and authorized resource references.', inputSchema: object({ page: { type: 'integer', minimum: 1, maximum: 10000 }, unreadOnly: { type: 'boolean' } }) },
  { name: 'mark_notification_read', description: 'Mark one of your notifications read. Confirmation must exactly match READ NOTIFICATION <id>.', inputSchema: object({ id, confirmation }, ['id', 'confirmation']) },
  { name: 'delete_notification', description: 'Delete one of your notifications. Confirmation must exactly match DELETE NOTIFICATION <id>.', inputSchema: object({ id, confirmation }, ['id', 'confirmation']) },
] as const;

export const notificationTools = new Set<string>(notificationToolDefinitions.map(tool => tool.name));
export const notificationWriteTools = new Set<string>(['update_notification_preferences', 'mark_notification_read', 'delete_notification']);

export async function executeNotificationTool(actor: NotificationActor, name: string, args: unknown) {
  const input = (args ?? {}) as Record<string, unknown>;
  switch (name) {
    case 'get_notification_preferences': return readNotificationPreferences(actor);
    case 'update_notification_preferences': return updateNotificationPreferences(actor, args);
    case 'list_notifications': return listNotifications(actor, {
      ...(typeof input.page === 'number' ? { page: input.page } : {}),
      ...(typeof input.unreadOnly === 'boolean' ? { unreadOnly: input.unreadOnly } : {}),
    });
    case 'mark_notification_read': {
      const notificationId = typeof input.id === 'string' ? input.id : '';
      if (input.confirmation !== notificationConfirmation.read(notificationId)) throw new OperationError('invalid_request', 'Confirmation must exactly identify the notification to mark read.');
      return markNotificationRead(actor, args);
    }
    case 'delete_notification': {
      const notificationId = typeof input.id === 'string' ? input.id : '';
      if (input.confirmation !== notificationConfirmation.delete(notificationId)) throw new OperationError('invalid_request', 'Confirmation must exactly identify the notification to delete.');
      return deleteNotification(actor, args);
    }
    default: throw new OperationError('invalid_request', `Choose a supported notification action (${NOTIFICATION_EVENTS.join(', ')}).`);
  }
}
