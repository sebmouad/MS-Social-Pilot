'use client';
import { useState } from 'react';
import { useAdsText } from '@/modules/ads/ui/AdsCopyProvider';
import { AdSetCreateForm } from '@/modules/ads/ui/AdSetCreateForm';
import { AdCreateForm } from '@/modules/ads/ui/AdCreateForm';
import type { AdsUiSchema } from '@/platforms/ads-ui';
import type { CreationOwnerScope } from '@/modules/ads/ui/creationRequestStore';

/** One ad-set form under a stored-campaign picker; the form keeps its own review, confirmation and recovery. */
export function AdSetCreatePicker({ adAccountId, currency, campaigns, config, ownerScope }: {
  adAccountId: string; currency: string | null; campaigns: Array<{ id: string; name: string }>;
  config: NonNullable<AdsUiSchema['adSet']>; ownerScope: CreationOwnerScope;
}) {
  const t = useAdsText();
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? '');
  if (!campaigns.length) return <p className="small-note">{t('manageNoCampaigns')}</p>;
  const campaign = campaigns.find(item => item.id === campaignId) ?? campaigns[0]!;
  return <div className="ads-create-picker">
    <p className="small-note">{t('manageCreateAdSetNote')}</p>
    <label>{t('text156')}<select value={campaign.id} onChange={event => setCampaignId(event.target.value)}>{campaigns.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <AdSetCreateForm key={campaign.id} adAccountId={adAccountId} campaignId={campaign.id} campaignName={campaign.name} currency={currency} config={config} ownerScope={ownerScope} />
  </div>;
}

/** One paused-ad form under a stored ad-set picker; the form keeps its own review, confirmation and recovery. */
export function AdCreatePicker({ adAccountId, adSets, nameMaxCharacters }: {
  adAccountId: string; adSets: Array<{ id: string; name: string }>; nameMaxCharacters: number;
}) {
  const t = useAdsText();
  const [adSetId, setAdSetId] = useState(adSets[0]?.id ?? '');
  if (!adSets.length) return <p className="small-note">{t('manageNoAdSets')}</p>;
  const adSet = adSets.find(item => item.id === adSetId) ?? adSets[0]!;
  return <div className="ads-create-picker">
    <label>{t('text157')}<select value={adSet.id} onChange={event => setAdSetId(event.target.value)}>{adSets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <AdCreateForm key={adSet.id} adAccountId={adAccountId} adSetId={adSet.id} adSetName={adSet.name} nameMaxCharacters={nameMaxCharacters} />
  </div>;
}
