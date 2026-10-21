import { z } from 'zod';
import { entry } from '@/lib/config/entry';

export const mediaPresentationPolicySchema = z.object({
  holdersPerImage: z.number().int().min(1).max(100),
  fileNameMaxCharacters: z.number().int().min(1).max(255),
  usagePreviewMaxCharacters: z.number().int().min(1).max(10000),
  fallbackFileName: z.string().trim().min(1).max(255).regex(/^[^/\\\u0000-\u001f\u007f]+$/),
}).strict();
export type MediaPresentationPolicy = z.infer<typeof mediaPresentationPolicySchema>;
export const mediaPresentationPolicy: MediaPresentationPolicy = {
  holdersPerImage: 5, fileNameMaxCharacters: 180, usagePreviewMaxCharacters: 80, fallbackFileName: 'image',
};

/** Integration: spread MEDIA_PRESENTATION_CONFIG into Publishing's owning config.ts. */
export const MEDIA_PRESENTATION_CONFIG = [entry({
  key: 'storage.mediaPresentationPolicy', group: 'Publishing · Media', label: 'Media usage and filename bounds',
  kind: 'json', description: 'Visible usage holders, preview text and display filename limits. Stored files always use validated UUIDs, never display names.',
  defaultValue: mediaPresentationPolicy, schema: mediaPresentationPolicySchema, consumption: 'active',
})] as const;

