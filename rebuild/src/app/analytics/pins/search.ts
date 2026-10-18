import { z } from 'zod';

/** Pins accept only scalar, UTC date filters; unknown keys cannot be overwritten by page defaults. */
export const pinnedSearchSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();
