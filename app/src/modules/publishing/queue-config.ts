import { z } from 'zod';
import { entry } from '@/lib/config/entry';

// Calendar field ranges are protocol invariants; the selected initial values are Root-managed.
export const queueDefaultSlotSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
}).strict();
export const QUEUE_CONFIG = [entry({
  key: 'publishing.queue.defaultSlot', group: 'Publishing · Queue', label: 'Initial queue time', kind: 'json',
  description: 'Initial weekday and local time in the queue timetable editor. Existing saved times are unchanged.',
  defaultValue: { dayOfWeek: 1, hour: 9, minute: 0 }, schema: queueDefaultSlotSchema, consumption: 'active',
})] as const;
