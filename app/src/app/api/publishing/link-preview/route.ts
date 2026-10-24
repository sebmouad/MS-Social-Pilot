import { linkPreviewCacheHttp, linkPreviewHttp } from '@/modules/studio/content-tools/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** POST fetches (and caches); GET serves the cache only, never fetching. */
export const GET = linkPreviewCacheHttp;
export const POST = linkPreviewHttp;
