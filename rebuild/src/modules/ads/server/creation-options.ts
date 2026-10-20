import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { platformAds } from '@/server/platforms/registry';
import { getAdsAccountWhere } from './queries';
import { canManageWorkspaceAds } from './actions';
import { authorizeAdsRead, type AdsReadActor } from './access';
export async function readAdsCreationOptions(actor: AdsReadActor, input: Record<string, unknown>) {
  const access = await authorizeAdsRead(actor);
  const adAccountId = input.adAccountId;
  if (typeof adAccountId !== 'string' || Object.keys(input).some(key => key !== 'adAccountId')) throw new OperationError('invalid_request', 'Choose an advertising account.');
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(adAccountId)) throw new OperationError('invalid_request', 'Invalid ad account ID.');
  const where = await getAdsAccountWhere(actor.workspaceId, access.allowedTargetIds, access.allowedProviders, access.allowedAdAccountIds);
  const account = await prisma.adAccount.findFirst({
    where: { AND: [where, { id: adAccountId }] },
    select: { id: true, currency: true, socialAccount: { select: { provider: true } } },
  });
  const provider = account?.socialAccount?.provider;
  const host = provider ? await platformAds(provider) : null;
  const manageable = account && await canManageWorkspaceAds(access.actor, adAccountId);
  if (!account || !provider || !host || !manageable) throw new OperationError('unavailable', 'The selected advertising account is unavailable.');
  const creationUi = host.creationUi ? await host.creationUi() : host.ui;
  return {
    adAccountId: account.id,
    provider,
    currency: account.currency,
    campaign: creationUi.campaign ? { options: creationUi.campaign.options, defaultOption: creationUi.campaign.defaultOption, confirmationTemplate: creationUi.campaign.confirmationTemplate, nameMaxLength: creationUi.campaign.nameMaxLength } : null,
    adSet: access.allowedTargetIds === undefined && creationUi.adSet ? { options: creationUi.adSet.options, defaultOption: creationUi.adSet.defaultOption, confirmationTemplate: creationUi.adSet.confirmationTemplate, nameMaxLength: creationUi.adSet.nameMaxLength, countryCodeFormat: 'Two uppercase letters, for example MA', dailyBudgetFormat: 'Positive integer in minor currency units' } : null,
  };
}
