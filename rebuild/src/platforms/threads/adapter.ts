import type { DiscoveryRequest, OAuthExchangeRequest, OAuthStartRequest, PublishRequest, PlatformAdapter } from '../types';
import { threadsModule } from './module';
import { threadsPolicySchema, type ThreadsPolicy } from './config';
/** Failure messages never contain response bodies, URLs or credentials. */
export class ThreadsError extends Error {
    constructor(message: string, readonly state: 'rejected' | 'uncertain' | 'processing') { super(message); }
}
export function createThreadsAdapter(input: ThreadsPolicy, dependencies: {
    fetch?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    locale?: 'en' | 'fr';
    now?: () => number;
} = {}) {
    const policy = threadsPolicySchema.parse(input);
    const transport = dependencies.fetch ?? fetch;
    const locale = dependencies.locale ?? 'en';
    const copy = (key: keyof ThreadsPolicy['copy']) => policy.copy[key][locale];
    const pause = dependencies.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    async function call(url: string, params: Record<string, string>, method: 'GET' | 'POST' = 'GET', token?: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
        const target = new URL(url);
        if (method === 'GET')
            target.search = new URLSearchParams(params).toString();
        try {
            const response = await transport(target, { method, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(policy.timeoutMs)]) : AbortSignal.timeout(policy.timeoutMs), headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, ...(method === 'POST' ? { body: new URLSearchParams(params) } : {}) });
            const data: unknown = await response.json();
            if (!response.ok || !data || typeof data !== 'object' || 'error' in data)
                throw new ThreadsError(copy(method === 'POST' ? 'uncertain' : 'unavailable'), method === 'POST' ? 'uncertain' : 'rejected');
            return data as Record<string, unknown>;
        }
        catch (error) {
            if (error instanceof ThreadsError)
                throw error;
            throw new ThreadsError(copy(method === 'POST' ? 'uncertain' : 'unavailable'), method === 'POST' ? 'uncertain' : 'rejected');
        }
    }
    const graph = (path: string) => `${policy.graphUrl.replace(/\/$/, '')}/${path}`;
    const id = (value: unknown) => { if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d+$/.test(String(value)))
        throw new ThreadsError(copy('unavailable'), 'uncertain'); return String(value); };
    async function wait(containerId: string, token: string, signal?: AbortSignal) {
        for (let attempt = 0; attempt < policy.pollAttempts; attempt++) {
            const data = await call(graph(containerId), { fields: 'status,error_message' }, 'GET', token, signal);
            if (data.status === 'FINISHED' || data.status === 'PUBLISHED')
                return;
            if (data.status === 'ERROR' || data.status === 'EXPIRED')
                throw new ThreadsError(copy('invalid'), 'rejected');
            if (attempt + 1 < policy.pollAttempts)
                await pause(policy.pollIntervalMs);
        }
        throw new ThreadsError(copy('processing'), 'processing');
    }
    return {
        id: 'threads',
        capabilities: threadsModule.capabilities,
        getAuthorizationUrl(request: OAuthStartRequest) { const url = new URL(policy.authorizationUrl); url.search = new URLSearchParams({ client_id: request.appId, redirect_uri: request.redirectUri, state: request.state, scope: policy.scopes.join(','), response_type: 'code' }).toString(); return url.toString(); },
        async exchangeCode(request: OAuthExchangeRequest) {
            const short = await call(policy.tokenUrl, { client_id: request.appId, client_secret: request.appSecret, code: request.code, redirect_uri: request.redirectUri, grant_type: 'authorization_code' }, 'POST');
            if (typeof short.access_token !== 'string')
                throw new ThreadsError(copy('unavailable'), 'rejected');
            const long = await call(policy.exchangeUrl, { grant_type: 'th_exchange_token', client_secret: request.appSecret, access_token: short.access_token });
            if (typeof long.access_token !== 'string' || typeof long.expires_in !== 'number' || long.expires_in <= 0)
                throw new ThreadsError(copy('unavailable'), 'rejected');
            return { accessToken: long.access_token, expiresAt: new Date((dependencies.now ?? Date.now)() + long.expires_in * 1000), userId: id(short.user_id) };
        },
        async refreshToken(token: string) { const data = await call(policy.refreshUrl, { grant_type: 'th_refresh_token' }, 'GET', token); if (typeof data.access_token !== 'string' || typeof data.expires_in !== 'number' || data.expires_in <= 0)
            throw new ThreadsError(copy('unavailable'), 'rejected'); return { accessToken: data.access_token, expiresAt: new Date((dependencies.now ?? Date.now)() + data.expires_in * 1000) }; },
        async discover(request: DiscoveryRequest) { const data = await call(graph('me'), { fields: 'id,username,name,threads_profile_picture_url' }, 'GET', request.credential.accessToken); if (typeof data.username !== 'string')
            throw new ThreadsError(copy('unavailable'), 'rejected'); return { targets: [{ id: id(data.id), name: data.username, kind: 'threads' }] }; },
        async publish(request: PublishRequest) {
            const media = request.media ?? [];
            const validUrl = (url: string) => { try {
                const u = new URL(url);
                return u.protocol === 'https:' && !u.username && !u.password;
            }
            catch {
                return false;
            } };
            if (request.scheduledAt || request.target.kind !== 'threads' || request.formatId || request.text.length > policy.maxTextCharacters || media.length > policy.maxMedia || (!request.text.trim() && !media.length) || media.some(item => item.localFile || item.altText !== undefined || !validUrl(item.url)) || (request.link && (!validUrl(request.link) || media.length)))
                throw new ThreadsError(copy('invalid'), 'rejected');
            const user = id(request.target.id);
            const token = request.credential.accessToken;
            const container = async (params: Record<string, string>) => id((await call(graph(`${user}/threads`), params, 'POST', token, request.signal)).id);
            const mediaParams = (item: typeof media[number]) => ({ media_type: item.kind === 'video' ? 'VIDEO' : 'IMAGE', [item.kind === 'video' ? 'video_url' : 'image_url']: item.url });
            let creation: string;
            if (media.length > 1) {
                const children: string[] = [];
                for (const item of media) {
                    const child = await container({ ...mediaParams(item), is_carousel_item: 'true' });
                    children.push(child);
                    await wait(child, token, request.signal);
                }
                creation = await container({ media_type: 'CAROUSEL', children: children.join(','), text: request.text });
            }
            else
                creation = await container({ ...(media[0] ? mediaParams(media[0]) : { media_type: 'TEXT', ...(request.link ? { link_attachment: request.link } : {}) }), text: request.text });
            await wait(creation, token, request.signal);
            const remoteId = id((await call(graph(`${user}/threads_publish`), { creation_id: creation }, 'POST', token, request.signal)).id);
            // A permalink lookup failure cannot erase a successful publication receipt.
            const receipt = await call(graph(remoteId), { fields: 'permalink' }, 'GET', token, request.signal).catch(() => null);
            return { remoteId, url: typeof receipt?.permalink === 'string' ? receipt.permalink : null, state: 'published' as const };
        },
        classifyPublishingFailure(error: unknown) { return error instanceof ThreadsError && error.state === 'rejected' ? 'rejected' as const : 'uncertain' as const; },
    } satisfies PlatformAdapter & { refreshToken(token: string): Promise<{ accessToken: string; expiresAt: Date }> };
}
