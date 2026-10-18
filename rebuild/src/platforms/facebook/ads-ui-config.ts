import { z } from 'zod';
import { entry } from '@/lib/config/entry';
import type { AdsUiSchema } from '@/platforms/ads-ui';

/** Implemented Graph choices are protocol constants; Root may select and relabel this subset. */
const objectives = ['OUTCOME_AWARENESS','OUTCOME_ENGAGEMENT','OUTCOME_LEADS','OUTCOME_SALES','OUTCOME_TRAFFIC','OUTCOME_APP_PROMOTION'] as const;
const goals = ['LINK_CLICKS','IMPRESSIONS'] as const;
const copy = z.string().trim().min(1).max(1000);
const common = { title: copy, description: copy, nameLabel: copy, nameMaxLength: z.number().int().min(1).max(100), actionLabel: copy, confirmTitle: copy, confirmDescription: copy, confirmationTemplate: copy };
const choices = (values: readonly [string, ...string[]]) => z.array(z.object({ value: z.enum(values), label: copy }).strict()).min(1).max(values.length).refine(items => new Set(items.map(item => item.value)).size === items.length, 'Choices must be unique.');
export const FACEBOOK_ADS_CREATION_UI_SCHEMA = z.object({
  campaign: z.object({ ...common, optionLabel: copy, options: choices(objectives), defaultOption: z.enum(objectives) }).strict(),
  adSet: z.object({ ...common, budgetLabel: copy, countryLabel: copy, goalLabel: copy, options: choices(goals), defaultOption: z.enum(goals) }).strict(),
}).strict().superRefine((value, context) => {
  for (const key of ['campaign','adSet'] as const) {
    if (!value[key].options.some(option => option.value === value[key].defaultOption)) context.addIssue({ code: z.ZodIssueCode.custom, path: [key,'defaultOption'], message: 'Choose an enabled option as the default.' });
    if (value[key].confirmationTemplate !== FACEBOOK_ADS_UI_DEFAULTS[key].confirmationTemplate) context.addIssue({ code: z.ZodIssueCode.custom, path: [key,'confirmationTemplate'], message: 'The installed adapter fixes this confirmation format.' });
  }
});
export const FACEBOOK_ADS_UI_DEFAULTS = {
    campaign: {
      nameLabel: 'Campaign name', nameMaxLength: 100, optionLabel: 'Objective', title: 'Create paused campaign',
      description: 'Creates a paused campaign. Complete its ad setup before activating delivery.',
      actionLabel: 'Create paused campaign', confirmTitle: 'Create this paused campaign?', confirmDescription: 'It will not deliver until activated separately.',
      defaultOption: 'OUTCOME_TRAFFIC', options: [
        { value: 'OUTCOME_AWARENESS', label: 'Awareness' }, { value: 'OUTCOME_ENGAGEMENT', label: 'Engagement' },
        { value: 'OUTCOME_LEADS', label: 'Leads' }, { value: 'OUTCOME_SALES', label: 'Sales' },
        { value: 'OUTCOME_TRAFFIC', label: 'Traffic' }, { value: 'OUTCOME_APP_PROMOTION', label: 'App promotion' },
      ],
      confirmationTemplate: 'CREATE PAUSED FACEBOOK CAMPAIGN {nameJson} IN ACCOUNT {adAccountId} WITH OBJECTIVE {objective}',
    },
    adSet: {
      nameLabel: 'Ad set name', nameMaxLength: 100, budgetLabel: 'Daily budget', countryLabel: 'Country code', goalLabel: 'Optimize for',
      title: 'Create paused ad set under {campaignName}',
      description: 'Uses impressions billing. Enter a daily amount{currency}; delivery targets one country.',
      actionLabel: 'Create paused ad set', confirmTitle: 'Create this paused ad set?', confirmDescription: 'It will not deliver until activated separately.',
      defaultOption: 'LINK_CLICKS', options: [{ value: 'LINK_CLICKS', label: 'Link clicks' }, { value: 'IMPRESSIONS', label: 'Impressions' }],
      confirmationTemplate: 'CREATE PAUSED FACEBOOK AD SET {nameJson} UNDER CAMPAIGN {campaignId} IN ACCOUNT {adAccountId} WITH DAILY BUDGET {dailyBudgetMinor} MINOR UNITS{currencySuffix} TARGETING {countryCode} OPTIMIZED FOR {optimizationGoal}',
    },
  } satisfies AdsUiSchema;
export const FACEBOOK_ADS_CREATION_CONFIG = [entry({ key: 'meta.adsCreationUi', group: 'Facebook · Ads creation', label: 'Creation choices and copy', kind: 'json', description: 'Safe form labels, implemented objective/optimization choices, defaults and name ceilings. Confirmation templates are reviewed separately by the provider engine.', defaultValue: FACEBOOK_ADS_UI_DEFAULTS, schema: FACEBOOK_ADS_CREATION_UI_SCHEMA, consumption: 'active' })] as const;
