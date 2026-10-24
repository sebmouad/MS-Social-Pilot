import { expect, it } from 'vitest';
import { FACEBOOK_ADS_UI_DEFAULTS, FACEBOOK_ADS_CREATION_UI_SCHEMA } from '@/platforms/facebook/ads-ui-config';
it('accepts installed defaults and a Root-selected supported subset with relabelled copy', () => {
  expect(FACEBOOK_ADS_CREATION_UI_SCHEMA.safeParse(FACEBOOK_ADS_UI_DEFAULTS).success).toBe(true);
  const value = structuredClone(FACEBOOK_ADS_UI_DEFAULTS);
  value.campaign.options = [{ value: 'OUTCOME_TRAFFIC', label: 'Website visitors' }];
  value.campaign.defaultOption = 'OUTCOME_TRAFFIC';
  value.campaign.nameMaxLength = 32;
  expect(FACEBOOK_ADS_CREATION_UI_SCHEMA.safeParse(value).success).toBe(true);
});
it('refuses unsupported choices, missing selected defaults and confirmation-format changes', () => {
  const unsupported = structuredClone(FACEBOOK_ADS_UI_DEFAULTS);
  unsupported.campaign.options = [{ value: 'not-an-implemented-objective', label: 'Unsupported' }];
  expect(FACEBOOK_ADS_CREATION_UI_SCHEMA.safeParse(unsupported).success).toBe(false);
  const missing = structuredClone(FACEBOOK_ADS_UI_DEFAULTS);
  missing.campaign.options = [{ value: 'OUTCOME_TRAFFIC', label: 'Traffic' }];
  missing.campaign.defaultOption = 'OUTCOME_SALES';
  expect(FACEBOOK_ADS_CREATION_UI_SCHEMA.safeParse(missing).success).toBe(false);
  const confirmation = structuredClone(FACEBOOK_ADS_UI_DEFAULTS);
  confirmation.adSet.confirmationTemplate = 'CREATE WITHOUT ACCOUNT OR BUDGET';
  expect(FACEBOOK_ADS_CREATION_UI_SCHEMA.safeParse(confirmation).success).toBe(false);
});
