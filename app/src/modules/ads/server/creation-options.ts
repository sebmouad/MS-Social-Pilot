import { withAdsCopySnapshot } from '@/modules/ads/server/copy';
import { adsServiceText } from '@/modules/ads/server/copy';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { platformAds } from '@/server/platforms/registry';
import { getAdsAccountWhere } from './queries';
import { canManageWorkspaceAds } from './actions';
import { describeAdsManagement } from '@/modules/ads/management/server';
import { authorizeAdsRead, type AdsReadActor } from './access';
export async function readAdsCreationOptions(actor: AdsReadActor, input: Record<string, unknown>) {
  return withAdsCopySnapshot(async () => {
  const access = await authorizeAdsRead(actor);
  const adAccountId = input.adAccountId;
  if (typeof adAccountId !== 'string' || Object.keys(input).some(key => key !== 'adAccountId')) throw new OperationError('invalid_request', await adsServiceText('service011'));
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(adAccountId)) throw new OperationError('invalid_request', await adsServiceText('service012'));
  const where = await getAdsAccountWhere(actor.workspaceId, access.allowedTargetIds, access.allowedProviders, access.allowedAdAccountIds);
  const account = await prisma.adAccount.findFirst({
    where: { AND: [where, { id: adAccountId }] },
    select: { id: true, name: true, currency: true, socialAccount: { select: { provider: true } } },
  });
  const provider = account?.socialAccount?.provider;
  const host = provider ? await platformAds(provider) : null;
  const manageable = account && await canManageWorkspaceAds(access.actor, adAccountId);
  // Say why when the only problem is a connection missing advertising permissions.
  if (account && provider && host && !manageable && (await describeAdsManagement(access.actor, adAccountId)).needsReconnect) {
    throw new OperationError('reconnect_required', `${await adsServiceText('needsReconnectAccount', { account: account.name })} ${await adsServiceText('needsReconnectAction')}: /settings/channels`);
  }
  if (!account || !provider || !host || !manageable) throw new OperationError('unavailable', await adsServiceText('service003'));
  const creationUi = host.creationUi ? await host.creationUi() : host.ui;
  return {
    adAccountId: account.id,
    provider,
    currency: account.currency,
    campaign: creationUi.campaign ? { options: creationUi.campaign.options, defaultOption: creationUi.campaign.defaultOption, confirmationTemplate: creationUi.campaign.confirmationTemplate, nameMaxLength: creationUi.campaign.nameMaxLength } : null,
    adSet: access.allowedTargetIds === undefined && creationUi.adSet ? { options: creationUi.adSet.options, defaultOption: creationUi.adSet.defaultOption, confirmationTemplate: creationUi.adSet.confirmationTemplate, nameMaxLength: creationUi.adSet.nameMaxLength, countryCodeFormat: 'Two uppercase letters, for example MA', dailyBudgetFormat: 'Positive integer in minor currency units' } : null,
  };

  });
}
