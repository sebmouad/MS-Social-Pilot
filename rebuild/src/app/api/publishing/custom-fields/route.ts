import { handle, jsonBody, query } from '@/modules/publishing/collaboration/http';
import { createCustomField, readCustomFields } from '@/modules/publishing/collaboration/server/custom-fields';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handle(request, { feature: 'publishing/collaboration', fallback: 'Custom fields could not be loaded.', run: async actor => { query(request, []); return { fields: await readCustomFields(actor) }; } });
export const POST = (request: Request) => handle(request, { feature: 'publishing/collaboration', write: true, success: 201, fallback: 'The custom field could not be saved.', run: async actor => createCustomField(actor, await jsonBody(request)) });
