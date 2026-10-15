import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireViewer } from '@/server/context';
import { moderateFacebookComment, replyToFacebookInbox, setFacebookInboxResolved, syncFacebookInbox } from '@/server/inbox/actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('sync'), targetId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional() }).strict(),
  z.object({ action: z.literal('reply'), kind: z.enum(['message', 'comment']), id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), text: z.string().max(2000) }).strict(),
  z.object({ action: z.literal('resolve'), kind: z.enum(['message', 'comment']), id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), resolved: z.boolean() }).strict(),
  z.object({ action: z.literal('moderate'), id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), hidden: z.boolean() }).strict(),
]);

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request denied.' }, { status: 403 });
  let viewer;
  try { viewer = await requireViewer({ feature: 'inbox/conversations', channelScoped: true }); }
  catch { return NextResponse.json({ error: 'Not authorized.' }, { status: 401 }); }
  try {
    const input = schema.parse(await request.json());
    const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
    const result = input.action === 'sync' ? await syncFacebookInbox(actor, input.targetId)
      : input.action === 'reply' ? await replyToFacebookInbox(actor, input)
      : input.action === 'resolve' ? await setFacebookInboxResolved(actor, input)
      : await moderateFacebookComment(actor, input);
    return NextResponse.json({ ok: true, ...result }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid inbox action.' }, { status: 400 });
    const message = error instanceof Error ? error.message : '';
    const known: Array<[string, number]> = [
      ['Invalid inbox item', 400], ['Write a reply', 400], ['no longer a member', 401], ['not have access', 403], ['not enabled', 403],
      ['unavailable', 409], ['Reconnect this Facebook source', 403], ['Inbox is unavailable for this connection', 403],
    ];
    const match = known.find(([phrase]) => message.includes(phrase));
    return match ? NextResponse.json({ error: message }, { status: match[1], headers: { 'cache-control': 'no-store' } })
      : NextResponse.json({ error: 'The inbox action could not be completed. Check the Facebook connection and try again.' }, { status: 502, headers: { 'cache-control': 'no-store' } });
  }
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
