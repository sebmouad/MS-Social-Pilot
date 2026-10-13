import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { registerClient, registrationSchema } from '@/lib/oauth';

/** Dynamic client registration (RFC 7591): public clients only, PKCE required later. */
export async function POST(request: Request) {
  try {
    const input = registrationSchema.parse(await request.json());
    const client = await registerClient(input);
    return NextResponse.json(
      {
        client_id: client.id,
        client_name: client.name,
        redirect_uris: client.redirectUris,
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof ZodError ? error.issues.map((issue) => issue.message).join('; ') : 'Send JSON with redirect_uris.';
    return NextResponse.json({ error: 'invalid_client_metadata', error_description: message }, { status: 400 });
  }
}
