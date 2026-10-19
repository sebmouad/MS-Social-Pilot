import { z } from 'zod';
import { entry } from '@/lib/config/entry';

const number = (key: string, label: string, description: string, value: number, min: number, max: number) => entry({ key, group: 'Publishing · Media inspection', label, description, kind: 'number', defaultValue: value, schema: z.number().int().min(min).max(max), consumption: 'active' });
export const MEDIA_INSPECTION_CONFIG = [
  number('media.inspectMaxBytes', 'Inspection input maximum (bytes)', 'Largest immutable media snapshot accepted for metadata inspection.', 536870912, 1024, 2147483647),
  number('media.inspectMaxPixels', 'Inspection maximum pixels', 'Largest width times height accepted for an inspected frame.', 100000000, 1, 1000000000),
  number('media.inspectTimeoutMs', 'Metadata inspection timeout (ms)', 'Maximum duration of local image/video metadata inspection. Expiry stops the probe and refuses its result.', 15000, 100, 120000),
  number('media.inspectMaxOutputBytes', 'Probe response maximum (bytes)', 'Maximum metadata output accepted from the configured video probe.', 1048576, 1024, 8388608),
  entry({ key: 'media.ffprobePath', group: 'Publishing · Media inspection', label: 'Video metadata probe executable', description: 'Trusted operator-managed ffprobe executable. Use ffprobe from the service PATH or an absolute path; arguments are fixed and no shell is used.', kind: 'text', defaultValue: 'ffprobe', schema: z.string().max(4096).refine(value => value === 'ffprobe' || value.startsWith('/') && !/[\u0000-\u001f\u007f]/.test(value)), consumption: 'active' }),
  entry({ key: 'media.inspectTempRoot', group: 'Publishing · Media inspection', label: 'Private inspection temporary directory', description: 'Existing absolute directory where unique private probe directories are created and removed. The host must provide a canonical real directory.', kind: 'text', defaultValue: '/tmp', schema: z.string().min(1).max(4096).refine(value => value.startsWith('/') && !/[\u0000-\u001f\u007f]/.test(value)), consumption: 'active' }),
  number('media.inspectFetchTimeoutMs', 'Source download timeout (ms)', 'Overall download deadline including DNS, redirects and body bytes.', 30000, 100, 300000),
  number('media.inspectMaxRedirects', 'Source redirect maximum', 'Every redirected URL and resolved address is checked before connecting.', 3, 0, 10),
  entry({ key: 'media.inspectAllowHttp', group: 'Publishing · Media inspection', label: 'Allow public HTTP inspection sources', description: 'Permit unencrypted public HTTP media sources. Private addresses remain refused.', kind: 'boolean', defaultValue: false, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'media.inspectHostAllowlist', group: 'Publishing · Media inspection', label: 'Inspection source host allowlist', description: 'Allowed public source hosts, including their subdomains. Empty permits any public host; private/special-use addresses are always blocked.', kind: 'json', defaultValue: [], schema: z.array(z.string().trim().min(1).max(253).regex(/^[A-Za-z0-9.-]+$/)).max(100), consumption: 'active' }),
  number('media.inspectMaxConcurrentImages', 'Concurrent image inspections per process', 'Maximum live Sharp decoding tasks per application process. A timed-out request retains its slot until decoding settles; excess work is refused.', 2, 1, 8),
] as const;
