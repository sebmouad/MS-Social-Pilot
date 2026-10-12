import { describe, expect, it } from 'vitest';

import { aspectRangeFor, cropBox, parseWatermark } from '../src/lib/image-format';

describe('aspectRangeFor', () => {
  it('knows stories, Instagram feed posts, and leaves the rest alone', () => {
    expect(aspectRangeFor('page', 'story')).toEqual({ min: 9 / 16, max: 9 / 16 });
    expect(aspectRangeFor('instagram', 'post')).toEqual({ min: 0.8, max: 1.91 });
    expect(aspectRangeFor('page', 'post')).toBeNull();
    expect(aspectRangeFor('bluesky', 'post')).toBeNull();
  });
});

describe('cropBox', () => {
  const instagram = { min: 0.8, max: 1.91 };

  it('leaves an image that already fits', () => {
    expect(cropBox(1080, 1080, instagram)).toBeNull();
    expect(cropBox(1080, 1351, instagram)).toBeNull();
  });

  it('crops a tall image to 4:5 around the centre', () => {
    expect(cropBox(1000, 2000, instagram)).toEqual({ left: 0, top: 375, width: 1000, height: 1250 });
  });

  it('crops a wide image to 1.91:1, following the focal point to the edge', () => {
    expect(cropBox(4000, 1000, instagram, { x: 0, y: 0.5 })).toEqual({ left: 0, top: 0, width: 1910, height: 1000 });
    expect(cropBox(4000, 1000, instagram, { x: 1, y: 0.5 })).toEqual({ left: 2090, top: 0, width: 1910, height: 1000 });
    expect(cropBox(4000, 1000, instagram, { x: 0.25, y: 0.5 })).toEqual({ left: 45, top: 0, width: 1910, height: 1000 });
  });

  it('makes a square photo a 9:16 story', () => {
    expect(cropBox(1080, 1080, { min: 9 / 16, max: 9 / 16 })).toEqual({ left: 236, top: 0, width: 608, height: 1080 });
  });
});

describe('parseWatermark', () => {
  it('is null without a logo or text', () => {
    expect(parseWatermark(null)).toBeNull();
    expect(parseWatermark({ text: '  ', position: 'center' })).toBeNull();
  });

  it('cleans and clamps what it is given', () => {
    expect(parseWatermark({ text: ' Client A ', position: 'nowhere', opacity: 500, size: 1 })).toEqual({
      text: 'Client A',
      position: 'bottom-end',
      opacity: 100,
      size: 5,
    });
    expect(parseWatermark({ mediaId: 'm1', position: 'top-start', opacity: 40, size: 20 })).toEqual({
      mediaId: 'm1',
      position: 'top-start',
      opacity: 40,
      size: 20,
    });
  });
});
