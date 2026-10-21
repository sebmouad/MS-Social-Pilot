import { cache } from 'react';
import { runtimeConfig } from '@/server/config/store';
import { overviewCopySchema, overviewLocaleCopy } from '../overview-copy';
const catalog = cache(async () => overviewCopySchema.parse(await runtimeConfig('analytics.overviewCopy')));
export async function loadOverviewCopy(locale: 'en' | 'fr') { return overviewLocaleCopy(await catalog(), locale); }
