import { isIP } from 'node:net';
import { z } from 'zod';
import { entry } from '@/lib/config/entry';

const hostSchema = z.string().max(253).refine((value) => value === '' || isIP(value) !== 0 || value.split('.').every((part) => part.length > 0 && part.length <= 63 && /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(part)), 'Enter a hostname or IP address without a URL or port.');
const exactOrigin = (value: string) => {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return parsed.origin === value && (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && parsed.hostname === 'localhost'));
  } catch { return false; }
};

export const MAIL_CONFIG = [
  entry({ key: 'mail.enabled', group: 'Shared · Transactional mail', label: 'Transactional email enabled', kind: 'boolean', description: 'Allow account and workspace transactional messages through the configured SMTP service.', defaultValue: false, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'mail.publicOrigin', group: 'Shared · Transactional mail', label: 'Public application origin', kind: 'text', description: 'Exact public HTTPS origin used in transactional email links. Localhost HTTP is allowed for development.', defaultValue: '', schema: z.string().max(300).refine(exactOrigin, 'Use an exact HTTPS origin or localhost HTTP origin.'), consumption: 'active' }),
  entry({ key: 'mail.smtpHost', group: 'Shared · Transactional mail', label: 'SMTP host', kind: 'text', description: 'SMTP hostname or IP address, without a URL or port.', defaultValue: '', schema: hostSchema, consumption: 'active' }),
  entry({ key: 'mail.smtpPort', group: 'Shared · Transactional mail', label: 'SMTP port', kind: 'number', description: 'TCP port used by the SMTP service.', defaultValue: 587, schema: z.number().int().min(1).max(65535), consumption: 'active' }),
  entry({ key: 'mail.smtpSecure', group: 'Shared · Transactional mail', label: 'SMTP implicit TLS', kind: 'boolean', description: 'Use TLS immediately when connecting, typically on port 465.', defaultValue: false, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'mail.smtpRequireTls', group: 'Shared · Transactional mail', label: 'Require SMTP TLS upgrade', kind: 'boolean', description: 'Require STARTTLS for non-local SMTP hosts. Local mail capture can disable this in development.', defaultValue: true, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'mail.smtpUsername', group: 'Shared · Transactional mail', label: 'SMTP username', kind: 'text', description: 'Optional SMTP authentication username.', defaultValue: '', schema: z.string().max(320), consumption: 'active' }),
  entry({ key: 'mail.smtpPassword', group: 'Shared · Transactional mail', label: 'SMTP password', kind: 'secret', description: 'SMTP authentication password, encrypted at rest.', defaultValue: '', schema: z.string().max(4096), consumption: 'active' }),
  entry({ key: 'mail.fromAddress', group: 'Shared · Transactional mail', label: 'Sender address', kind: 'text', description: 'Email address used as the transactional message sender.', defaultValue: '', schema: z.string().max(320).refine((value) => value === '' || z.string().email().safeParse(value).success, 'Enter a valid email address.'), consumption: 'active' }),
  entry({ key: 'mail.fromName', group: 'Shared · Transactional mail', label: 'Sender name', kind: 'text', description: 'Display name used for transactional messages.', defaultValue: 'MS Social Pilot', schema: z.string().trim().min(1).max(120), consumption: 'active' }),
  entry({ key: 'mail.connectionTimeoutMs', group: 'Shared · Transactional mail', label: 'SMTP connection timeout (ms)', kind: 'number', description: 'Maximum time to establish an SMTP connection.', defaultValue: 10000, schema: z.number().int().min(1000).max(60000), consumption: 'active' }),
  entry({ key: 'mail.socketTimeoutMs', group: 'Shared · Transactional mail', label: 'SMTP socket timeout (ms)', kind: 'number', description: 'Maximum idle time for an SMTP connection or response.', defaultValue: 30000, schema: z.number().int().min(1000).max(120000), consumption: 'active' }),
  entry({ key: 'mail.subjectMaxCharacters', group: 'Shared · Transactional mail', label: 'Email subject limit', kind: 'number', description: 'Maximum subject length accepted by the shared mail service.', defaultValue: 200, schema: z.number().int().min(1).max(1000), consumption: 'active' }),
  entry({ key: 'mail.bodyMaxBytes', group: 'Shared · Transactional mail', label: 'Email body byte limit', kind: 'number', description: 'Maximum UTF-8 size of the text and optional HTML message bodies combined.', defaultValue: 262144, schema: z.number().int().min(1024).max(2097152), consumption: 'active' }),
] as const;

export const MAIL_TRANSPORT_SCHEMA = z.object({
  enabled: z.boolean(), publicOrigin: z.string(), smtpHost: hostSchema, smtpPort: z.number().int().min(1).max(65535),
  smtpSecure: z.boolean(), smtpRequireTls: z.boolean(), smtpUsername: z.string().max(320), smtpPassword: z.string().max(4096),
  fromAddress: z.string().max(320), fromName: z.string().trim().min(1).max(120), connectionTimeoutMs: z.number().int().min(1000).max(60000),
  socketTimeoutMs: z.number().int().min(1000).max(120000), subjectMaxCharacters: z.number().int().min(1).max(1000), bodyMaxBytes: z.number().int().min(1024).max(2097152),
}).strict().superRefine((config, context) => {
  if (!exactOrigin(config.publicOrigin)) context.addIssue({ code: 'custom', path: ['publicOrigin'], message: 'invalid_origin' });
  if (!config.enabled) return;
  if (!config.smtpHost || !config.fromAddress || !z.string().email().safeParse(config.fromAddress).success) context.addIssue({ code: 'custom', message: 'incomplete_mail_configuration' });
  if ((config.smtpUsername === '') !== (config.smtpPassword === '')) context.addIssue({ code: 'custom', message: 'incomplete_smtp_authentication' });
  const local = config.smtpHost === 'localhost' || config.smtpHost === '127.0.0.1' || config.smtpHost === '::1';
  if (!local && !config.smtpSecure && !config.smtpRequireTls) context.addIssue({ code: 'custom', message: 'smtp_tls_required' });
});

export type MailTransportConfig = z.infer<typeof MAIL_TRANSPORT_SCHEMA>;
