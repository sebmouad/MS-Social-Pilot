import { webhookSecretHttp } from '@/modules/settings/server/webhook-secrets-http';
export const dynamic = 'force-dynamic';
export const POST = async (request: Request, { params }: { params: Promise<{ id: string }> }) => webhookSecretHttp(request, (await params).id, 'reveal');
