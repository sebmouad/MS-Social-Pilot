import { describe, it, expect, vi } from 'vitest';
vi.mock('@/server/data', () => ({ prisma: {} }));
vi.mock('@/modules/ai/server/access', () => ({ authorizeAi: vi.fn() }));
vi.mock('@/modules/ai/server/ai', () => ({ runAssist: vi.fn() }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: vi.fn() }));
import { agentRequest } from '@/modules/agents/server/service';
import { agentPolicySchema } from '@/modules/agents/config';
describe('writing agent request boundary', () => {
 it('rejects injected actor and cross-workspace arguments', () => { expect(agentRequest.safeParse({ action: 'list', workspaceId: 'other' }).success).toBe(false); });
 it('requires confirmation and explicit suggestion kind', () => {
  expect(agentRequest.safeParse({ action: 'draft', id: 'a', text: 'hello', kind: 'publish', confirmation: 'DRAFT a' }).success).toBe(false);
  expect(agentRequest.safeParse({ action: 'delete', id: 'a' }).success).toBe(false);
 });
 it('validates bounded Root policy', () => { expect(agentPolicySchema.safeParse({ maxAgents: 0, nameCharacters: 1, instructionsCharacters: 1, voiceCharacters: 1 }).success).toBe(false); });
});
