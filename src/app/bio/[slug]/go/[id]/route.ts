import { NextResponse } from 'next/server';

import { followBioLink } from '@/lib/bio';

type Context = { params: Promise<{ slug: string; id: string }> };

/** Count the click, then send the visitor on. */
export async function GET(_request: Request, context: Context) {
  const { slug, id } = await context.params;
  const url = await followBioLink(slug, id);
  if (!url) return new NextResponse('Not found', { status: 404 });
  return NextResponse.redirect(url, 302);
}
