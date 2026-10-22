import { runtimeConfig } from '@/server/config/store';
import { asyncExportCopySchema, ASYNC_POST_EXPORT_COPY } from './config';
export async function postExportCopy(locale: 'en' | 'fr' = 'en') {
 const saved = asyncExportCopySchema.parse(await runtimeConfig('publishing.asyncExportCopy'));
 return { ...ASYNC_POST_EXPORT_COPY[locale], ...saved[locale] };
}
