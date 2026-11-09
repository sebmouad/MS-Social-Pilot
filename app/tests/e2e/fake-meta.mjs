// A local stand-in for Facebook's login dialog and the Graph API, for clicking through MS Social Pilot's Facebook,
// Instagram and Ads screens end to end without touching a real Page. HTTPS on localhost (self-signed); every call is
// logged, an unknown route is logged UNMATCHED. Test-only routes /__test/* simulate a visitor commenting or messaging.
//   node tests/e2e/fake-meta.mjs <port> <cert.pem> <key.pem>
import https from 'node:https';
import { readFileSync } from 'node:fs';

const [port = '4600', cert, key] = process.argv.slice(2);
const PAGE = { id: '111222333', name: 'Test Kitchen', category: 'Food & Beverage', token: 'PAGE-TOKEN-111' };
const IG = { id: '178900001', username: 'testkitchen', followers: 1240 };
const AD = { id: 'act_900100', name: 'Test Kitchen Ads', currency: 'EUR' };
const VISITOR = { id: '700800900', name: 'Sara Visitor' };
const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'read_insights', 'pages_read_user_content', 'pages_manage_engagement', 'pages_messaging', 'pages_manage_metadata',
  'instagram_basic', 'instagram_content_publish', 'instagram_manage_comments', 'instagram_manage_insights', 'ads_read', 'ads_management', 'public_profile'];
const now = () => new Date().toISOString().replace(/\.\d+Z$/, '+0000');
let seq = Math.floor(Date.now() / 1000) % 100000000; // never reused across restarts, like real ids
const state = { posts: new Map(), comments: new Map(), conversations: new Map(), containers: new Map(), igMedia: new Map(), campaigns: new Map(), subscribed: [] };
state.campaigns.set('6100001', { id: '6100001', account_id: AD.id.replace('act_', ''), name: 'Autumn recipes', objective: 'OUTCOME_TRAFFIC', status: 'PAUSED', effective_status: 'PAUSED' });

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const error = (res, message, code = 100) => json(res, 400, { error: { message, type: 'OAuthException', code } });
const series = (name, base) => ({ name, period: 'day', values: Array.from({ length: 7 }, (_, i) => ({ value: base + i * 3, end_time: new Date(Date.now() - (6 - i) * 864e5).toISOString().slice(0, 10) + 'T07:00:00+0000' })) });

function dialog(url, res) {
  const scopes = (url.searchParams.get('scope') ?? '').split(',').filter(Boolean);
  const back = new URL(url.searchParams.get('redirect_uri'));
  back.searchParams.set('code', 'FAKE-CODE'); back.searchParams.set('state', url.searchParams.get('state') ?? '');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><title>Facebook (test)</title><body style="font:16px system-ui;background:#f0f2f5;margin:0">
<div style="max-width:520px;margin:48px auto;background:#fff;border-radius:12px;padding:28px;box-shadow:0 2px 12px #0002">
<h1 style="color:#1877f2;font-size:22px">facebook <small style="color:#888;font-size:13px">(local test double)</small></h1>
<p><b>MS Social Pilot</b> is requesting access to:</p><ul>${scopes.map(s => `<li><code>${s}</code></li>`).join('')}</ul>
<p>Page: <b>${PAGE.name}</b> · Instagram: <b>@${IG.username}</b> · Ad account: <b>${AD.name}</b></p>
<a id="continue" href="${back}" style="display:inline-block;background:#1877f2;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none">Continue as Test Owner</a></div>`);
}

function graph(method, path, q, body, res) {
  const p = path.replace(/^\/v\d+\.\d+/, '');
  const parts = p.split('/').filter(Boolean);
  const [head, edge] = parts;
  // Login and identity
  if (p === '/oauth/access_token') return json(res, 200, { access_token: q.fb_exchange_token ? 'LONG-USER-TOKEN' : 'SHORT-USER-TOKEN', token_type: 'bearer', expires_in: 5183944 });
  if (p === '/me' && (q.fields ?? '').includes('link')) return json(res, 200, { id: '10001', link: 'https://www.facebook.com/test.owner' });
  if (p === '/me') return json(res, 200, { id: '10001', name: 'Test Owner', picture: { data: { url: 'https://localhost:' + port + '/pic.png' } } });
  if (p === '/me/permissions') return json(res, 200, { data: SCOPES.map(permission => ({ permission, status: 'granted' })) });
  if (p === '/me/accounts') return json(res, 200, { data: [{ id: PAGE.id, name: PAGE.name, category: PAGE.category, access_token: PAGE.token, picture: { data: { url: '' } } }] });
  if (p === '/me/adaccounts') return json(res, 200, { data: [{ id: AD.id, name: AD.name, currency: AD.currency, account_status: 1 }] });
  // Page
  if (head === PAGE.id && !edge && method === 'GET') return json(res, 200, { id: PAGE.id, name: PAGE.name, fan_count: 6262, followers_count: 6262, instagram_business_account: { id: IG.id, username: IG.username }, picture: { data: { url: '' } } });
  if (head === PAGE.id && edge === 'picture') return json(res, 200, { data: { url: `https://localhost:${port}/page.png`, width: 50, height: 50 } });
  if (head === PAGE.id && edge === 'subscribed_apps') { state.subscribed.push(body.subscribed_fields); return json(res, 200, { success: true }); }
  if (head === PAGE.id && (edge === 'feed' || edge === 'photos') && method === 'POST') {
    const id = `${PAGE.id}_${++seq}`; state.posts.set(id, { id, message: body.message ?? body.caption ?? '', created_time: now(), comments: [] });
    return json(res, 200, edge === 'photos' ? { id: String(seq), post_id: id } : { id });
  }
  if (head === PAGE.id && ['feed', 'posts', 'published_posts'].includes(edge)) return json(res, 200, { data: [...state.posts.values()].map(post => ({ id: post.id, message: post.message, created_time: post.created_time, permalink_url: `https://www.facebook.com/${post.id}` })) });
  if (head === PAGE.id && edge === 'insights') return json(res, 200, { data: (q.metric ?? 'page_follows').split(',').map((m, i) => series(m, 40 + i * 25)) });
  if (head === PAGE.id && edge === 'conversations') return json(res, 200, { data: [...state.conversations.values()].map(c => ({ id: c.id, snippet: c.messages.at(-1).message, updated_time: c.messages.at(-1).created_time, unread_count: 1, message_count: c.messages.length, participants: { data: [VISITOR, { id: PAGE.id, name: PAGE.name }] }, messages: { data: [...c.messages].reverse() } })) });
  if (head === PAGE.id && edge === 'messages' && method === 'POST') {
    const recipient = JSON.parse(body.recipient ?? '{}').id; const text = JSON.parse(body.message ?? '{}').text;
    const conversation = [...state.conversations.values()].find(c => c.visitor === recipient);
    if (!conversation || !text) return error(res, '(#100) No matching user found', 100);
    const id = `m_${++seq}`; conversation.messages.push({ id, message: text, created_time: now(), from: { id: PAGE.id, name: PAGE.name } });
    return json(res, 200, { recipient_id: recipient, message_id: id });
  }
  if (head === PAGE.id && edge === 'ratings') return json(res, 200, { data: [] });
  // Posts and comments
  if (state.posts.has(head) && !edge) {
    if (method === 'DELETE') { state.posts.delete(head); return json(res, 200, { success: true }); }
    const post = state.posts.get(head);
    return json(res, 200, { id: post.id, message: post.message, created_time: post.created_time, is_published: true, permalink_url: `https://www.facebook.com/${post.id.replace('_', '/posts/')}`, status_type: 'mobile_status_update', shares: { count: 2 }, reactions: { summary: { total_count: 12 } }, comments: { summary: { total_count: post.comments.length } } });
  }
  if (state.posts.has(head) && edge === 'comments' && method === 'GET') return json(res, 200, { data: state.posts.get(head).comments.map(id => state.comments.get(id)) });
  if (state.posts.has(head) && edge === 'comments' && method === 'POST') { const id = `${head}_c${++seq}`; state.comments.set(id, { id, message: body.message, created_time: now(), from: { id: PAGE.id, name: PAGE.name } }); state.posts.get(head).comments.push(id); return json(res, 200, { id }); }
  if (state.posts.has(head) && edge === 'insights') return json(res, 200, { data: (q.metric ?? '').split(',').filter(Boolean).map((m, i) => ({ name: m, period: 'lifetime', values: [{ value: 120 + i * 10 }] })) });
  if (state.comments.has(head) && edge === 'comments' && method === 'POST') { const id = `${head}_r${++seq}`; state.comments.set(id, { id, message: body.message, created_time: now(), from: { id: PAGE.id, name: PAGE.name }, parent: { id: head } }); return json(res, 200, { id }); }
  if (state.comments.has(head) && !edge && method === 'POST') { state.comments.get(head).is_hidden = body.is_hidden === 'true'; return json(res, 200, { success: true }); }
  if (state.comments.has(head) && !edge && method === 'DELETE') { state.comments.delete(head); return json(res, 200, { success: true }); }
  // Instagram
  if (head === IG.id && !edge) return json(res, 200, { id: IG.id, username: IG.username, name: PAGE.name, followers_count: IG.followers, media_count: state.igMedia.size, profile_picture_url: '' });
  if (head === IG.id && edge === 'media' && method === 'POST') { const id = `C${++seq}`; state.containers.set(id, { caption: body.caption ?? '', url: body.image_url ?? body.video_url }); return json(res, 200, { id }); }
  if (state.containers.has(head) && !edge) return json(res, 200, { status_code: 'FINISHED' });
  if (head === IG.id && edge === 'media_publish') { const c = state.containers.get(body.creation_id); if (!c) return error(res, 'Invalid creation id'); const id = `1800${++seq}`; state.igMedia.set(id, { id, caption: c.caption, comments: [], timestamp: now() }); return json(res, 200, { id }); }
  if (head === IG.id && edge === 'media') return json(res, 200, { data: [...state.igMedia.values()].map(m => ({ id: m.id, caption: m.caption, media_type: 'IMAGE', media_product_type: 'FEED', permalink: `https://www.instagram.com/p/${m.id}/`, timestamp: m.timestamp, like_count: 9, comments_count: m.comments.length })) });
  if (head === IG.id && edge === 'insights') return json(res, 200, { data: [{ name: q.metric, period: 'day', values: series(q.metric, 30).values, total_value: { value: 210 } }] });
  if (state.igMedia.has(head) && !edge) { const m = state.igMedia.get(head); return json(res, 200, { id: m.id, owner: { id: IG.id }, permalink: `https://www.instagram.com/p/${m.id}/`, caption: m.caption, timestamp: m.timestamp }); }
  if (state.igMedia.has(head) && edge === 'comments') return json(res, 200, { data: state.igMedia.get(head).comments.map(id => state.comments.get(id)) });
  if (state.igMedia.has(head) && edge === 'insights') return json(res, 200, { data: [{ name: q.metric ?? 'reach', values: [{ value: 88 }] }] });
  if (state.comments.has(head) && edge === 'replies' && method === 'GET') return json(res, 200, { data: [] });
  if (state.comments.has(head) && edge === 'replies' && method === 'POST') { const id = `${head}_r${++seq}`; state.comments.set(id, { id, text: body.message, timestamp: now(), from: { id: IG.id, username: IG.username } }); return json(res, 200, { id }); }
  if (state.comments.has(head) && !edge && body.hide !== undefined) { state.comments.get(head).hidden = body.hide === 'true'; return json(res, 200, { success: true }); }
  // Ads
  // Like Graph: each level's rows carry the ids of that level (adset_id at adset level, ad_id at ad level).
  if (head === AD.id && edge === 'insights') { const level = q.level ?? 'account'; return json(res, 200, { data: Array.from({ length: 7 }, (_, i) => { const d = new Date(Date.now() - (6 - i) * 864e5).toISOString().slice(0, 10); return { date_start: d, date_stop: d, impressions: String(900 + i * 80), reach: String(700 + i * 50), spend: (4.2 + i).toFixed(2), clicks: String(20 + i * 3), cpc: '0.21', cpm: '4.60', account_id: AD.id.replace('act_', ''), account_name: AD.name,
    ...(level !== 'account' ? { campaign_id: '6100001', campaign_name: 'Autumn recipes' } : {}), ...(level === 'adset' || level === 'ad' ? { adset_id: '6200001', adset_name: 'France · 25-54' } : {}), ...(level === 'ad' ? { ad_id: '6300001', ad_name: 'Pumpkin soup photo' } : {}) }; }) }); }
  if (head === AD.id && edge === 'campaigns' && method === 'POST') { const id = String(6100000 + ++seq); state.campaigns.set(id, { id, account_id: AD.id.replace('act_', ''), name: body.name, objective: body.objective, status: body.status, effective_status: body.status }); return json(res, 200, { id }); }
  if (head === AD.id && edge === 'campaigns') return json(res, 200, { data: [...state.campaigns.values()] });
  if (head === AD.id && (edge === 'adsets' || edge === 'ads' || edge === 'adcreatives')) return json(res, 200, { data: [] });
  if (head === AD.id && !edge) return json(res, 200, { id: AD.id, name: AD.name, currency: AD.currency, account_status: 1 });
  if (state.campaigns.has(head) && !edge) { if (method === 'POST') Object.assign(state.campaigns.get(head), body); return json(res, 200, method === 'POST' ? { success: true } : state.campaigns.get(head)); }
  return null;
}

https.createServer({ cert: readFileSync(cert), key: readFileSync(key) }, (req, res) => {
  const url = new URL(req.url, `https://localhost:${port}`);
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    const q = Object.fromEntries(url.searchParams);
    const body = (req.headers['content-type'] ?? '').includes('json') ? JSON.parse(raw || '{}') : Object.fromEntries(new URLSearchParams(raw));
    const log = (tag) => console.log(`${new Date().toISOString().slice(11, 19)} ${tag} ${req.method} ${url.pathname} ${JSON.stringify({ ...q, ...body, access_token: undefined, appsecret_proof: undefined }).slice(0, 220)}`);
    if (url.pathname.endsWith('/dialog/oauth')) { log('DIALOG'); return dialog(url, res); }
    if (url.pathname === '/__test/comment') { const post = state.posts.get(body.post) ?? state.igMedia.get(body.post); if (!post) return error(res, 'unknown post'); const id = `${body.post}_v${++seq}`;
      state.comments.set(id, { id, message: body.text, text: body.text, created_time: now(), timestamp: now(), from: { id: VISITOR.id, name: VISITOR.name, username: 'sara.visitor' } }); post.comments.push(id); log('TEST'); return json(res, 200, { id }); }
    if (url.pathname === '/__test/message') { const id = `t_${++seq}`; state.conversations.set(id, { id, visitor: VISITOR.id, messages: [{ id: `m_${++seq}`, message: body.text, created_time: now(), from: VISITOR }] }); log('TEST'); return json(res, 200, { id }); }
    if (url.pathname === '/__test/state') return json(res, 200, { posts: [...state.posts.values()], comments: [...state.comments.values()], conversations: [...state.conversations.values()], igMedia: [...state.igMedia.values()], campaigns: [...state.campaigns.values()], subscribed: state.subscribed });
    const handled = graph(req.method, url.pathname, q, body, res);
    if (handled === null) { log('UNMATCHED'); return url.pathname.split('/').filter(Boolean).length > 2 ? json(res, 200, { data: [] }) : error(res, `Unsupported path ${url.pathname}`); }
    log('OK');
  });
}).listen(Number(port), () => console.log(`fake Meta on https://localhost:${port}`));
