import { OperationError } from '@/lib/operation-error';
import { runtimeConfigBatch } from '@/server/config/store';
import { readWorkspaceImage } from '@/modules/publishing/server/media/storage';
import { altTextRequestSchema, cleanOutput, type AltTextResult } from '../ai';
import { altTextPolicySchema } from '../config';
import { authorizeAi, type AiActor } from './access';
import { claim, complete, COMPOSER_FEATURE, settings, workspaceContext, type AiDeps } from './ai';
import { recordUsage } from './usage';

const fillPrompt = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
const unavailable = () => new OperationError('unavailable', 'AI writing assist is not available.');
async function limits() {
  try {
    const values = await runtimeConfigBatch(['ai.altTextPolicy', 'ai.languageMaxCharacters', 'publishing.maxImageAltCharacters']);
    const policy = altTextPolicySchema.parse(values['ai.altTextPolicy']);
    const languageMax = Number(values['ai.languageMaxCharacters']); const maxCharacters = Number(values['publishing.maxImageAltCharacters']);
    if (!Number.isSafeInteger(languageMax) || !Number.isSafeInteger(maxCharacters) || maxCharacters < 1) return null;
    return { policy, languageMax, maxCharacters };
  } catch { return null; }
}

/** Whether alt-text suggestions can be offered now (configured, switched on for the workspace, member may write posts). */
export async function altTextAvailable(actor: AiActor, deps: AiDeps = {}): Promise<boolean> {
  try { await authorizeAi(actor, COMPOSER_FEATURE, 'write'); } catch { return false; }
  const [s, workspace, bounds] = await Promise.all([settings(deps), workspaceContext(actor.workspaceId), limits()]);
  return Boolean(s && workspace?.enabled && bounds?.policy.enabled);
}

/**
 * Suggest a description for one stored image of this workspace. The image is read tenant-bound from the
 * workspace's own storage (never by URL), sent once to the configured provider, and the suggestion is
 * returned for review: nothing is saved or published. Same authorization, Root switch and hourly/budget
 * limits as composer assist, for UI, REST and MCP.
 */
export async function suggestAltText(actor: AiActor, input: unknown, deps: AiDeps = {}): Promise<AltTextResult> {
  const bounds = await limits();
  if (!bounds) throw unavailable();
  const parsed = altTextRequestSchema(bounds.languageMax).safeParse(input);
  if (!parsed.success) throw new OperationError('invalid_request', 'Choose one stored image of this workspace.');
  await authorizeAi(actor, COMPOSER_FEATURE, 'write');
  const [s, workspace] = await Promise.all([settings(deps), workspaceContext(actor.workspaceId)]);
  const { policy, maxCharacters } = bounds;
  if (!s || !workspace?.enabled || !policy.enabled) throw unavailable();
  let image;
  try { image = await readWorkspaceImage(actor.workspaceId, parsed.data.imageId); }
  catch { throw new OperationError('not_found', 'This image is unavailable in the current workspace.'); }
  if (image.bytes.byteLength > policy.maxImageBytes) throw new OperationError('invalid_request', 'This image is too large to describe automatically. Write the description yourself.');
  const now = (deps.now ?? (() => new Date()))();
  await claim(actor, s, 'alt_text', image.bytes.byteLength, now);
  const prompt = fillPrompt(policy.instruction, { language: parsed.data.language ?? policy.defaultLanguage, maxCharacters: String(maxCharacters) });
  const raw = await complete(s, policy.system, prompt, { mimeType: image.mimeType, base64: image.bytes.toString('base64') });
  await recordUsage(s.metering, actor, 'alt_text', policy.system.length + prompt.length, raw.length, now);
  const text = cleanOutput(raw, maxCharacters);
  if (!text) throw new OperationError('upstream_failure', 'AI assist returned an empty answer. Try again.');
  return { text };
}
