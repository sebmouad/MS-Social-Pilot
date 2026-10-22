import { retentionGet, retentionPost } from '@/modules/settings/server/retention-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Old-records cleanup status and confirmed clean-up. Owners and admins only; the service repeats every check. */
export const GET = retentionGet;
export const POST = retentionPost;
