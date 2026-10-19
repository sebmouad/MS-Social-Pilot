/** Safe media failures. Messages are selected here; raw system errors never enter this type. */
export type MediaValidationCode = 'invalid_limit' | 'invalid_form' | 'empty_body' | 'invalid_file' | 'too_large' | 'invalid_type' | 'invalid_content' | 'invalid_cursor' | 'invalid_listing_limit';

const VALIDATION_MESSAGES: Record<MediaValidationCode, string> = {
  invalid_limit: 'Image upload is unavailable right now.',
  invalid_form: 'Upload an image using a multipart form.',
  empty_body: 'Choose an image file to upload.',
  invalid_file: 'Choose an image file.',
  too_large: 'This image exceeds the upload size limit.',
  invalid_type: 'Choose a supported image format.',
  invalid_content: 'The image file could not be read.',
  invalid_cursor: 'Invalid media cursor.',
  invalid_listing_limit: 'Invalid media listing limit.',
};

export class MediaValidationError extends Error {
  constructor(readonly code: MediaValidationCode) {
    super(VALIDATION_MESSAGES[code]);
    this.name = 'MediaValidationError';
  }
}

export class MediaBodyTooLarge extends MediaValidationError {
  constructor() { super('too_large'); this.name = 'MediaBodyTooLarge'; }
}

export class MediaStorageUnavailable extends Error {
  constructor() {
    super('Image storage is temporarily unavailable. Try again later.');
    this.name = 'MediaStorageUnavailable';
  }
}
