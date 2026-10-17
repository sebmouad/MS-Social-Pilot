import { randomUUID } from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import { Prisma } from '../../../generated/client';
import { prisma } from '@/server/data';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import { MAIL_TRANSPORT_SCHEMA, type MailTransportConfig } from './config';

export type TransactionalMailInput = { to: string; subject: string; text: string; html?: string; template: string; workspaceId?: string };
export type MailDeliveryResult = { status: 'sent' | 'failed' | 'unavailable' | 'uncertain'; deliveryId?: string };
type MailConfigReader = (key: string) => Promise<unknown>;
type MailSecretReader = (key: string) => Promise<string | null>;
type MailTransport = Pick<Transporter, 'sendMail' | 'close'>;
type MailDependencies = {
  readConfig: MailConfigReader;
  readSecret: MailSecretReader;
  createTransport: (config: MailTransportConfig) => MailTransport;
  record: (input: { to: string; subject: string; template: string; workspaceId?: string; providerId?: string; status: 'sent' | 'failed'; error?: string }) => Promise<void>;
};

const keys = ['enabled','publicOrigin','smtpHost','smtpPort','smtpSecure','smtpRequireTls','smtpUsername','smtpPassword','fromAddress','fromName','connectionTimeoutMs','socketTimeoutMs','subjectMaxCharacters','bodyMaxBytes'] as const;


async function loadMailConfig(readConfig: MailConfigReader, readSecret: MailSecretReader): Promise<MailTransportConfig | null> {
  try {
    const values = await Promise.all(keys.map(async (key) => key === 'smtpPassword'
      ? (await readSecret(`mail.${key}`)) ?? ''
      : await readConfig(`mail.${key}`)));
    const candidate = Object.fromEntries(keys.map((key, index) => [key, values[index]]));
    const parsed = MAIL_TRANSPORT_SCHEMA.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

const safeRecipient = (value: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
function validInput(input: TransactionalMailInput, config: MailTransportConfig): boolean {
  return safeRecipient(input.to) && input.to.length <= 320 && typeof input.subject === 'string'
    && input.subject.length > 0 && input.subject.length <= config.subjectMaxCharacters && !/[\r\n]/.test(input.subject)
    && typeof input.text === 'string' && input.text.length > 0 && (input.html === undefined || typeof input.html === 'string')
    && Buffer.byteLength(input.text, 'utf8') + Buffer.byteLength(input.html ?? '', 'utf8') <= config.bodyMaxBytes
    && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(input.template)
    && (input.workspaceId === undefined || (typeof input.workspaceId === 'string' && input.workspaceId.length <= 128));
}

function makeDefaultTransport(config: MailTransportConfig): MailTransport {
  return nodemailer.createTransport({
    host: config.smtpHost, port: config.smtpPort, secure: config.smtpSecure, requireTLS: config.smtpRequireTls,
    connectionTimeout: config.connectionTimeoutMs, socketTimeout: config.socketTimeoutMs,
    ...(config.smtpUsername ? { auth: { user: config.smtpUsername, pass: config.smtpPassword } } : {}),
  });
}

const dependencies: MailDependencies = {
  readConfig: key => runtimeConfig(key),
  readSecret: key => runtimeSecret(key),
  createTransport: makeDefaultTransport,
  record: async (input) => {
    const id = randomUUID();
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO email_logs (id, "workspaceId", "to", template, subject, "providerId", status, error, "createdAt")
      VALUES (${id}, ${input.workspaceId ?? null}, ${input.to}, ${input.template}, ${input.subject}, ${input.providerId ?? null}, ${input.status}::"EmailStatus", ${input.error ?? null}, NOW())
    `);
  },
};

export function createTransactionalMailService(deps: MailDependencies = dependencies) {
  async function readyConfig() {
    const config = await loadMailConfig(deps.readConfig, deps.readSecret);
    return config?.enabled && config.smtpHost && config.fromAddress ? config : null;
  }

  return {
    async mailReady(): Promise<boolean> { return (await readyConfig()) !== null; },
    async publicMailOrigin(): Promise<string> {
      const config = await loadMailConfig(deps.readConfig, deps.readSecret);
      return config?.publicOrigin ?? '';
    },
    async sendTransactionalMail(input: TransactionalMailInput): Promise<MailDeliveryResult> {
      const config = await readyConfig();
      if (!config || !validInput(input, config)) return { status: 'unavailable' };

      let transport: MailTransport;
      try { transport = deps.createTransport(config); }
      catch { return { status: 'unavailable' }; }
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const send = transport.sendMail({
          from: { name: config.fromName, address: config.fromAddress }, to: input.to, subject: input.subject,
          text: input.text, ...(input.html === undefined ? {} : { html: input.html }),
        });
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => { timedOut = true; transport.close(); reject(new Error('mail_timeout')); }, config.socketTimeoutMs + config.connectionTimeoutMs);
        });
        const info = await Promise.race([send, timeout]);
        clearTimeout(timer);
        const accepted = Array.isArray(info.accepted) && info.accepted.some((address: unknown) => String(address).toLowerCase() === input.to.toLowerCase());
        const refused = Array.isArray(info.rejected) && info.rejected.some((address: unknown) => String(address).toLowerCase() === input.to.toLowerCase());
        if (refused) {
          await deps.record({ to: input.to, subject: input.subject, template: input.template, workspaceId: input.workspaceId, status: 'failed', error: 'recipient_refused' }).catch(() => undefined);
          return { status: 'failed' };
        }
        if (!accepted) return { status: 'uncertain' };
        const deliveryId = typeof info.messageId === 'string' && info.messageId.length <= 255 ? info.messageId : undefined;
        try {
          await deps.record({ to: input.to, subject: input.subject, template: input.template, workspaceId: input.workspaceId, providerId: deliveryId, status: 'sent' });
        } catch { return { status: 'uncertain' }; }
        return { status: 'sent', ...(deliveryId ? { deliveryId } : {}) };
      } catch {
        if (timer) clearTimeout(timer);
        const status = 'uncertain' as const;
        await deps.record({ to: input.to, subject: input.subject, template: input.template, workspaceId: input.workspaceId, status: 'failed', error: 'delivery_unconfirmed' }).catch(() => undefined);
        return { status };
      } finally {
        if (timer) clearTimeout(timer);
        try { transport.close(); } catch { /* transport cleanup is best effort */ }
      }
    },
  };
}

const service = createTransactionalMailService();
export const mailReady = service.mailReady;
export const publicMailOrigin = service.publicMailOrigin;
export const sendTransactionalMail = service.sendTransactionalMail;
