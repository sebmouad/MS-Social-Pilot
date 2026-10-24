import { NextResponse } from 'next/server';
import { signOut } from '@/server/auth-flow';

export async function POST() {
  await signOut();
  return NextResponse.json({ ok: true });
}
