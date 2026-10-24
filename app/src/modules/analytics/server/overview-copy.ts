import { configOrDefault } from '@/server/config/config-or-default';
import { cache } from 'react';
import { runtimeConfig } from '@/server/config/store';
import { overviewCopySchema, overviewLocaleCopy } from '../overview-copy';
const catalog = cache(async () => (await configOrDefault('analytics.overviewCopy', overviewCopySchema)));
export async function loadOverviewCopy(locale: 'en' | 'fr') { return overviewLocaleCopy(await catalog(), locale); }
