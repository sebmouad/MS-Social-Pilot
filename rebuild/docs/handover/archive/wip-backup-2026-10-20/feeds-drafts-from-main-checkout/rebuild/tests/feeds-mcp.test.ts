import { describe, expect, it } from 'vitest';
import { feedToolDefinitions, feedTools, feedWriteTools } from '../src/modules/feeds/mcp';
import { mediaToolDefinitions, mediaTools, mediaWriteTools } from '../src/modules/media/mcp';
import { FEEDS_CONFIG } from '../src/modules/feeds/config';
import { MEDIA_CONFIG } from '../src/modules/media/config';
import { AI_CONFIG } from '../src/modules/ai/config';

describe('tool and configuration exports', () => {
  it('declares closed schemas and confirmation fields for every write tool', () => {
    for (const [defs, writes] of [[feedToolDefinitions, feedWriteTools], [mediaToolDefinitions, mediaWriteTools]] as const) {
      for (const tool of defs) {
        expect(tool.inputSchema.additionalProperties).toBe(false);
        if (writes.has(tool.name) && tool.name !== 'check_content_feed') expect(Object.keys(tool.inputSchema.properties)).toContain('confirmation');
      }
    }
    expect(feedTools.size).toBe(5); expect(mediaTools.size).toBe(3);
  });
  it('registers unique, validated, active configuration keys with safe defaults', () => {
    const all = [...FEEDS_CONFIG, ...MEDIA_CONFIG, ...AI_CONFIG];
    expect(new Set(all.map(e => e.key)).size).toBe(all.length);
    for (const e of all) { expect(e.consumption).toBe('active'); expect(e.schema.safeParse(e.defaultValue).success).toBe(true); }
    expect(AI_CONFIG.find(e => e.key === 'ai.enabled')!.defaultValue).toBe(false);
    expect(AI_CONFIG.find(e => e.key === 'ai.apiKey')!.kind).toBe('secret');
    expect(FEEDS_CONFIG.find(e => e.key === 'feeds.allowHttp')!.defaultValue).toBe(false);
    expect(MEDIA_CONFIG.find(e => e.key === 'media.importAllowHttp')!.defaultValue).toBe(false);
  });
});
