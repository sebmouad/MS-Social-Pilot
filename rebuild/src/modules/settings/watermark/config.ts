import { z } from 'zod';
import { entry } from '@/lib/config/entry';
export const WATERMARK_CONFIG = [
  entry({ key: 'settings.watermarkMaxLogoBytes', group: 'Settings · Watermark', label: 'Maximum watermark logo bytes', description: 'Maximum uploaded or normalized PNG logo size. Raster PNG/JPEG only; animated logos are refused.', kind: 'number', defaultValue: 2097152, schema: z.number().int().min(1024).max(8388608), consumption: 'active' }),
] as const;
