import { z } from 'zod';
import { PlatformApiError } from '../errors';
import { policySchema, type Policy } from './config';
import { transport } from './transport';
const sessionSchema = z.object({ accessJwt: z.string().min(1), did: z.string().regex(/^did:[a-z]+:[^/\s]+$/), handle: z.string().min(1) });
/** AT Protocol identifiers and XRPC methods are protocol invariants, not Root options.
 * PDS redirects/DID endpoints are deliberately not followed with credentials.
 */
export function createClient(input: Policy, send: typeof fetch = fetch, locale: 'en' | 'fr' = 'en') {
  const policy = policySchema.parse(input), call = transport(policy, send, locale);
  const fail = () => new PlatformApiError(policy.unavailable[locale], false);
  return {
    async connect(identifier: string, appPassword: string) {
      if (!identifier.trim() || !/^[a-z0-9]{4}(-[a-z0-9]{4}){3}$/i.test(appPassword)) throw fail();
      const result = sessionSchema.safeParse(await call('xrpc/com.atproto.server.createSession', { identifier: identifier.trim().replace(/^@/, ''), password: appPassword }));
      if (!result.success) throw fail();
      return result.data;
    },
    async publish(session: z.infer<typeof sessionSchema>, text: string) {
      const parsed = sessionSchema.safeParse(session);
      if (!parsed.success || !text.trim() || [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length > policy.maxTextCharacters) throw fail();
      const result = z.object({ uri: z.string(), cid: z.string().min(1) }).safeParse(await call('xrpc/com.atproto.repo.createRecord', {
        repo: parsed.data.did, collection: 'app.bsky.feed.post', record: { $type: 'app.bsky.feed.post', text, createdAt: new Date().toISOString() },
      }, parsed.data.accessJwt));
      if (!result.success || !result.data.uri.startsWith(`at://${parsed.data.did}/app.bsky.feed.post/`)) throw fail();
      return { remoteId: result.data.uri, state: 'published' as const, url: null };
    },
  };
}
