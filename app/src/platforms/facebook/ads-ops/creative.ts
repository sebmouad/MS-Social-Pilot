import { defaultFacebookAdsText, type FacebookAdsText } from '../ads-copy';
import type { AdsNeutralOperation, AdsOpsContext } from '@/modules/ads/management/types';
import { runtimeConfig } from '@/server/config/store';
import { FacebookAdsOpsError, type FacebookAdsTransport } from './transport';

/** Standalone creatives have no PAUSED status. They stay unattached: this never creates or updates an ad.
 * Protocol mapping follows Meta's Marketing API collection (see ADS_PARITY.md).
 */
export async function executeFacebookCreative(transport: FacebookAdsTransport, context: AdsOpsContext, operation: Extract<AdsNeutralOperation, { type: 'creative.create' }>, text: FacebookAdsText = defaultFacebookAdsText) {
  const source = context.creative;
  if (!source || source.identityKind !== 'page' || !/^[0-9]+$/.test(source.identityId) || !context.recordReceipt) throw new FacebookAdsOpsError(text('creativeSourceInvalid'), { status: 0, beforeWrite: true }, 'creativeSourceInvalid');
  if (operation.format === 'post') {
    // The post must be the Page's own (its id starts with the Page id); Meta then promotes it as published, with its social proof.
    if (!operation.postId.startsWith(`${source.identityId}_`)) throw new FacebookAdsOpsError(text('postInvalid'), { status: 0, beforeWrite: true }, 'postInvalid');
    const result = await transport.post(`${encodeURIComponent(context.accountId)}/adcreatives`, context.credential.accessToken, { name: operation.name, object_story_id: operation.postId }, context.signal);
    if (typeof result.id !== 'string' || !/^[0-9]{1,100}$/.test(result.id)) throw new FacebookAdsOpsError(text('creativeUnconfirmed'), { status: 200 }, 'creativeUnconfirmed');
    await context.recordReceipt({ creativeId: result.id, postId: operation.postId });
    return { remoteId: result.id };
  }
  if (!source.image) throw new FacebookAdsOpsError(text('creativeSourceInvalid'), { status: 0, beforeWrite: true }, 'creativeSourceInvalid');
  const image0 = source.image;
  const [maxBytes, mimeTypes] = await Promise.all([runtimeConfig('meta.maxImageUploadBytes'), runtimeConfig('meta.allowedImageMimeTypes')]);
  if (!Number.isSafeInteger(maxBytes) || image0.bytes.length < 1 || image0.bytes.length > (maxBytes as number) || !Array.isArray(mimeTypes) || !(mimeTypes as readonly string[]).includes(image0.mimeType)) throw new FacebookAdsOpsError(text('imageUnsupported'), { status: 0, beforeWrite: true }, 'imageUnsupported');
  const token = context.credential.accessToken;
  const path = encodeURIComponent(context.accountId);
  const uploaded = await transport.post(`${path}/adimages`, token, { bytes: image0.bytes.toString('base64') }, context.signal);
  // From here on a remote image may exist. Even a later definite creative rejection is a partial result.
  try {
    const images = uploaded.images && typeof uploaded.images === 'object' && !Array.isArray(uploaded.images) ? Object.values(uploaded.images) : [];
    const image = images.length === 1 ? images[0] as { hash?: unknown } : null;
    if (typeof image?.hash !== 'string' || !/^[a-fA-F0-9]{32}$/.test(image.hash)) throw new Error('Missing image receipt.');
    await context.recordReceipt({ imageHash: image.hash, mediaId: operation.mediaId });
    const story = operation.format === 'link'
      ? { page_id: source.identityId, link_data: { image_hash: image.hash, link: operation.linkUrl, message: operation.message, ...(operation.title ? { name: operation.title } : {}) } }
      : { page_id: source.identityId, photo_data: { image_hash: image.hash, caption: operation.message } };
    const result = await transport.post(`${path}/adcreatives`, token, { name: operation.name, object_story_spec: JSON.stringify(story) }, context.signal);
    if (typeof result.id !== 'string' || !/^[0-9]{1,100}$/.test(result.id)) throw new Error('Missing creative receipt.');
    await context.recordReceipt({ imageHash: image.hash, creativeId: result.id, mediaId: operation.mediaId });
    return { remoteId: result.id };
  } catch {
    throw new FacebookAdsOpsError(text('creativeUnconfirmed'), { status: 0 }, 'creativeUnconfirmed');
  }
}
