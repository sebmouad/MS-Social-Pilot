import { describe, expect, it } from 'vitest';
import { OperationError } from '../src/lib/operation-error';
import { availablePublishingFormats, validatePublishingFormatDescriptors, validateSelectedPublishingFormat, type PublishingFormatDescriptor } from '../src/modules/publishing/formats';

const base = (id = 'format-a'): PublishingFormatDescriptor => ({
  id, label: 'Standard', media: { kinds: ['image', 'video'], maxImages: 4, maxVideos: 1, mixedKinds: false, linkWithMedia: false, imageAltText: true },
  firstComment: true, remoteStatus: true, remoteDelete: true, scheduling: { application: true, native: false },
});
const media = [{ kind: 'video' as const, url: 'https://media.example/video.mp4' }];
const expectOperationError = (run: () => unknown, code: string) => {
  try { run(); throw new Error('Expected OperationError'); }
  catch (error) { expect(error).toBeInstanceOf(OperationError); expect((error as OperationError).code).toBe(code); }
};

describe('provider-neutral publishing formats', () => {
  it('returns no choices when a module declares none and clones valid declarations', () => {
    expect(availablePublishingFormats(undefined)).toEqual([]);
    const input = [base()];
    const result = availablePublishingFormats(input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(result[0]!.media.kinds).not.toBe(input[0]!.media.kinds);
  });

  it('fails closed for malformed and duplicate descriptors', () => {
    expectOperationError(() => validatePublishingFormatDescriptors([{ ...base(), id: ' ' }]), 'unavailable');
    expectOperationError(() => validatePublishingFormatDescriptors([base(), base()]), 'unavailable');
    expect(validatePublishingFormatDescriptors([{ ...base(), scheduling: { application: false, native: true } }])[0]?.scheduling.native).toBe(true);
    expectOperationError(() => validatePublishingFormatDescriptors([{ ...base(), media: { ...base().media, maxVideos: 0 } }]), 'unavailable');
  });

  it('resolves only the explicitly selected format and validates content operations', () => {
    expect(validateSelectedPublishingFormat([base()], 'format-a', { media, firstComment: 'Hello', scheduled: true })).toEqual(base());
    expectOperationError(() => validateSelectedPublishingFormat([base()], 'unknown', { media }), 'invalid_request');
    expectOperationError(() => validateSelectedPublishingFormat([base()], undefined, { media }), 'invalid_request');
    expectOperationError(() => validateSelectedPublishingFormat([{ ...base(), firstComment: false }], 'format-a', { media, firstComment: 'Hello' }), 'invalid_request');
    expectOperationError(() => validateSelectedPublishingFormat([{ ...base(), scheduling: { application: false, native: false } }], 'format-a', { media, scheduled: true }), 'invalid_request');
    expectOperationError(() => validateSelectedPublishingFormat([{ ...base(), media: { ...base().media, kinds: ['image'], maxVideos: null } }], 'format-a', { media }), 'invalid_request');
  });
});

 it('accepts text-only modules and never serializes undeclared technical fields', () => {
 const input={...base(), secret:'never expose',media:{...base().media,kinds:[],maxImages:0,maxVideos:0,technical:'private'}};
 const result=availablePublishingFormats([input]);
 expect(result[0]?.media.kinds).toEqual([]);
 expect(JSON.stringify(result)).not.toMatch(/never expose|technical|private/);
 });
