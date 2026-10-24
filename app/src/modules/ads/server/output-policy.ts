import { withAdsCopySnapshot } from '@/modules/ads/server/copy';
import { adsServiceText } from '@/modules/ads/server/copy';
import { OperationError } from '@/lib/operation-error';
import { runtimeConfig } from '@/server/config/store';
import {
  ADS_DETAIL_MAX_BYTES_SCHEMA, ADS_EXPORT_FILE_NAME_SCHEMA, ADS_EXPORT_MAX_BYTES_SCHEMA,
  type AdsOutputPolicy,
} from '../output-policy';

export async function loadAdsOutputPolicy(readConfig: typeof runtimeConfig = runtimeConfig): Promise<AdsOutputPolicy> {
  return withAdsCopySnapshot(async () => {
  try {
    const [detailMaxBytes, exportMaxBytes, exportFileName] = await Promise.all([
      readConfig('ads.detailMaxBytes'), readConfig('ads.exportMaxBytes'), readConfig('ads.exportFileName'),
    ]);
    return {
      detailMaxBytes: ADS_DETAIL_MAX_BYTES_SCHEMA.parse(detailMaxBytes),
      exportMaxBytes: ADS_EXPORT_MAX_BYTES_SCHEMA.parse(exportMaxBytes),
      exportFileName: ADS_EXPORT_FILE_NAME_SCHEMA.parse(exportFileName),
    };
  } catch {
    throw new OperationError('unavailable', await adsServiceText('service018'));
  }

  });
}
