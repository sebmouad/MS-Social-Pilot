import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';

import { prisma } from './prisma';
import { env } from './env';
import { errors } from './errors';

/**
 * Passkeys and security keys (WebAuthn) as the second step. The challenge
 * lives on the session row it was issued to, so it is used once and only by
 * the browser that asked for it.
 */

function relyingParty() {
  const url = new URL(env.appUrl);
  return { rpID: url.hostname, origin: url.origin, rpName: url.hostname };
}

export async function passkeyRegistrationOptions(options: { userId: string; sessionId: string }) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: options.userId },
    select: { email: true, name: true, passkeys: { select: { credentialId: true, transports: true } } },
  });
  const { rpID, rpName } = relyingParty();
  const generated = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: user.email,
    userDisplayName: user.name,
    userID: new TextEncoder().encode(options.userId),
    attestationType: 'none',
    excludeCredentials: user.passkeys.map((passkey) => ({
      id: passkey.credentialId,
      transports: passkey.transports as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  });
  await prisma.session.update({ where: { id: options.sessionId }, data: { challenge: generated.challenge } });
  return generated;
}

export async function registerPasskey(options: {
  userId: string;
  sessionId: string;
  response: RegistrationResponseJSON;
  name: string;
}): Promise<void> {
  const session = await prisma.session.findUnique({ where: { id: options.sessionId } });
  if (!session?.challenge) throw errors.passkeyFailed();
  await prisma.session.update({ where: { id: session.id }, data: { challenge: null } });

  const { rpID, origin } = relyingParty();
  const result = await verifyRegistrationResponse({
    response: options.response,
    expectedChallenge: session.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  }).catch(() => null);
  if (!result?.verified || !result.registrationInfo) throw errors.passkeyFailed();

  const { credential } = result.registrationInfo;
  await prisma.passkey.create({
    data: {
      userId: options.userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? [],
      name: options.name.slice(0, 60),
    },
  });
}

export async function passkeyLoginOptions(options: { userId: string; sessionId: string }) {
  const passkeys = await prisma.passkey.findMany({
    where: { userId: options.userId },
    select: { credentialId: true, transports: true },
  });
  const generated = await generateAuthenticationOptions({
    rpID: relyingParty().rpID,
    allowCredentials: passkeys.map((passkey) => ({
      id: passkey.credentialId,
      transports: passkey.transports as AuthenticatorTransportFuture[],
    })),
    userVerification: 'preferred',
  });
  await prisma.session.update({ where: { id: options.sessionId }, data: { challenge: generated.challenge } });
  return generated;
}

export async function checkPasskey(options: {
  userId: string;
  sessionId: string;
  response: AuthenticationResponseJSON;
}): Promise<void> {
  const session = await prisma.session.findUnique({ where: { id: options.sessionId } });
  if (!session?.challenge) throw errors.passkeyFailed();
  await prisma.session.update({ where: { id: session.id }, data: { challenge: null } });

  const passkey = await prisma.passkey.findUnique({ where: { credentialId: options.response.id } });
  if (!passkey || passkey.userId !== options.userId) throw errors.passkeyFailed();

  const { rpID, origin } = relyingParty();
  const result = await verifyAuthenticationResponse({
    response: options.response,
    expectedChallenge: session.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: passkey.credentialId,
      publicKey: new Uint8Array(passkey.publicKey),
      counter: passkey.counter,
      transports: passkey.transports as AuthenticatorTransportFuture[],
    },
  }).catch(() => null);
  if (!result?.verified) throw errors.passkeyFailed();

  await prisma.passkey.update({
    where: { id: passkey.id },
    data: { counter: result.authenticationInfo.newCounter, lastUsedAt: new Date() },
  });
}
