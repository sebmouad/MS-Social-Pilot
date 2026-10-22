import { captionTestsListHttp, captionTestsStartHttp } from '@/modules/caption-tests/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = captionTestsListHttp;
export const POST = captionTestsStartHttp;
