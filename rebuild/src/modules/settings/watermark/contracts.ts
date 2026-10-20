import { z } from 'zod';

export const watermarkOptions = z.object({
  position: z.enum(['northwest', 'northeast', 'center', 'southwest', 'southeast']),
  opacity: z.number().min(0).max(1),
  scale: z.number().min(0.01).max(1),
}).strict();
export type WatermarkOptions = z.infer<typeof watermarkOptions>;
export type WatermarkState = WatermarkOptions | null;
export type WatermarkActor = { userId: string; workspaceId: string; allowedChannelIds?: readonly string[] };
export const watermarkAction = z.discriminatedUnion('action', [
  watermarkOptions.extend({ action: z.literal('save'), logoBase64: z.string().min(4).max(12_000_000).optional(), confirmation: z.literal('SAVE WATERMARK') }).strict(),
  z.object({ action: z.literal('remove'), confirmation: z.literal('REMOVE WATERMARK') }).strict(),
  z.object({ action: z.literal('apply'), imageId: z.string().uuid(), confirmation: z.literal('APPLY WATERMARK') }).strict(),
]);
