import { defaultPublishingErrorText, type PublishingErrorText } from '../../error-catalog';
/** Safe media failures; raw system errors never enter this type. */
export type MediaValidationCode = 'invalid_limit' | 'invalid_form' | 'empty_body' | 'invalid_file' | 'too_large' | 'invalid_type' | 'invalid_content' | 'invalid_cursor' | 'invalid_listing_limit';
export class MediaValidationError extends Error {
  constructor(readonly code: MediaValidationCode, text: PublishingErrorText = defaultPublishingErrorText) {
    super(text(`media_${code}`));
    this.name = 'MediaValidationError';
  }
}
export class MediaBodyTooLarge extends MediaValidationError {
  constructor(text: PublishingErrorText = defaultPublishingErrorText) { super('too_large', text); this.name = 'MediaBodyTooLarge'; }
}
export class MediaStorageUnavailable extends Error {
  constructor(text: PublishingErrorText = defaultPublishingErrorText) {
    super(text('media_storage'));
    this.name = 'MediaStorageUnavailable';
  }
}
