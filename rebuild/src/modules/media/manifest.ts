/**
 * The media library is a feature of the Publishing product module: posts attach its assets and its
 * access follows the `publishing/media` feature. Publishing's manifest spreads these declarations so
 * the library owns its navigation entry and Root setting keys; there is no separate module id.
 */
export const MEDIA_FEATURE_ID = 'publishing/media' as const;

export const MEDIA_PAGES = [
  { id: MEDIA_FEATURE_ID, title: 'Media library', href: '/publishing/media', description: 'Browse, search, import and clean up the images and videos your posts use.' },
] as const;

/** Must equal the keys of MEDIA_CONFIG (checked by tests/media-library-module.test.ts). */
export const MEDIA_ROOT_KEYS = [
  'media.webpImportPolicy', 'media.copy', 'media.messages', 'media.libraryPageSize', 'media.workspaceQuotaBytes', 'media.videoMaxBytes', 'media.allowedVideoMimeTypes', 'media.importMaxBytes',
  'media.importTimeoutMs', 'media.importMaxRedirects', 'media.importAllowHttp', 'media.importHostAllowlist', 'media.holderScanLimit',
  'media.holderListLimit', 'media.imageListLimit', 'media.holderExcerptCharacters', 'media.identifierMaxCharacters', 'media.pageNumberMax', 'media.importUrlMaxCharacters', 'media.assetNameMaxCharacters', 'media.searchMaxCharacters', 'media.transactionTimeoutMs', 'media.transactionMaxWaitMs',
] as const;
