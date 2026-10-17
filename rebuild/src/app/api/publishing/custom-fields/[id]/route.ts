import { handle, jsonBody } from '@/modules/publishing/collaboration/http';
import { deleteCustomField, updateCustomField } from '@/modules/publishing/collaboration/server/custom-fields';
import { OperationError } from '@/lib/operation-error';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
async function body(request: Request, id: string) { const value = await jsonBody(request); if (Object.hasOwn(value, 'id')) throw new OperationError('invalid_request', 'Choose a valid custom field.'); return { ...value, id }; }
export async function PUT(request: Request, context: Context) { const { id } = await context.params; return handle(request, { feature: 'publishing/posts', write: true, fallback: 'The custom field could not be saved.', run: async actor => updateCustomField(actor, await body(request, id)) }); }
export async function DELETE(request: Request, context: Context) { const { id } = await context.params; return handle(request, { feature: 'publishing/posts', write: true, fallback: 'The custom field could not be deleted.', run: async actor => deleteCustomField(actor, await body(request, id)) }); }
