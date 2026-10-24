import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CampaignCreateForm } from '../src/modules/ads/ui/CampaignCreateForm';
import { AdSetCreateForm } from '../src/modules/ads/ui/AdSetCreateForm';
import type { AdsUiSchema } from '../src/platforms/ads-ui';

const common = {
  title: 'Create a promotion', description: 'Provider-owned setup description',
  nameLabel: 'Promotion name', nameMaxLength: 47, actionLabel: 'Prepare promotion',
  confirmTitle: 'Prepare this promotion?', confirmDescription: 'Starts paused.',
  options: [{ value: 'visits', label: 'Website visits' }], defaultOption: 'visits',
  confirmationTemplate: 'PREPARE {nameJson} IN {adAccountId}',
};

describe('shared Ads creation UI', () => {
  it('renders another module’s campaign choices and limits without Facebook defaults', () => {
    const config: NonNullable<AdsUiSchema['campaign']> = { ...common, optionLabel: 'Promotion goal' };
    const html = renderToStaticMarkup(createElement(CampaignCreateForm, { adAccountId: 'account-1', accountName: 'Example account', config, ownerScope: { userId: 'user-1', workspaceId: 'workspace-1' } }));
    expect(html).toContain('Website visits');
    expect(html).toContain('maxLength="47"');
    expect(html).toContain('Provider-owned setup description');
    expect(html).not.toContain('OUTCOME_');
    expect(html).not.toContain('Facebook');
  });

  it('renders module-owned ad set choices instead of assuming Facebook optimization goals', () => {
    const config: NonNullable<AdsUiSchema['adSet']> = { ...common, budgetLabel: 'Spend per day', countryLabel: 'Country', goalLabel: 'Delivery goal' };
    const html = renderToStaticMarkup(createElement(AdSetCreateForm, { adAccountId: 'account-1', campaignId: 'promotion-1', campaignName: 'Example promotion', currency: 'USD', config, ownerScope: { userId: 'user-1', workspaceId: 'workspace-1' } }));
    expect(html).toContain('Website visits');
    expect(html).toContain('Delivery goal');
    expect(html).not.toContain('LINK_CLICKS');
    expect(html).not.toContain('Facebook');
  });
});
