'use server';
import { requireViewer } from '@/server/context';
import { postExportCopy } from '../../server/export/copy';
export async function loadPostExportLabels(locale: 'en' | 'fr') {
 await requireViewer({ feature: 'publishing/posts', channelScoped: true });
 return postExportCopy(locale);
}
