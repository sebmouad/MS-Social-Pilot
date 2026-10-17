import { z } from 'zod';

export type AdsOutputPolicy = {
  detailMaxBytes: number;
  exportMaxBytes: number;
  exportFileName: string;
};

export const ADS_OUTPUT_DEFAULT_POLICY: AdsOutputPolicy = {
  detailMaxBytes: 1_048_576,
  exportMaxBytes: 10_485_760,
  exportFileName: 'ads-report.csv',
};

export const ADS_DETAIL_MAX_BYTES_SCHEMA = z.number().int().min(1024).max(10_485_760);
export const ADS_EXPORT_MAX_BYTES_SCHEMA = z.number().int().min(1024).max(52_428_800);
export const ADS_EXPORT_FILE_NAME_SCHEMA = z.string().min(5).max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._ -]*\.csv$/, 'Use a safe CSV filename.');
