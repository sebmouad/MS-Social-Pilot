import { describe, expect, it } from 'vitest';
import { classifyMedia, classifySavedViewFeedback, MEDIA_ROUTES, SAVED_VIEW_ROUTE } from '../scripts/verify-browser-matrix';

describe('round 5 media fallback classification', () => {
  it('accepts placeholders for files that are gone', () => expect(classifyMedia({ images: 0, broken: 0, placeholders: 3 })).toEqual([]));
  it('accepts pages with healthy images', () => expect(classifyMedia({ images: 4, broken: 0, placeholders: 0 })).toEqual([]));
  it('reports a visible broken image with its count', () => expect(classifyMedia({ images: 4, broken: 2, placeholders: 1 })).toEqual([{ code: 'BROKEN_IMAGE_VISIBLE', count: 2 }]));
  it('covers every page that lists posts with media', () => expect(MEDIA_ROUTES).toEqual(['/content', '/content/queue', '/content/approvals', '/content/calendar']));
});

describe('round 5 saved-view expired-session classification', () => {
  it('requires some visible feedback', () => expect(classifySavedViewFeedback(null)).toEqual([{ code: 'SAVED_VIEW_NO_FEEDBACK' }]));
  it('rejects the naming message for a refused session', () => {
    expect(classifySavedViewFeedback('The view could not be saved. Check its name and try again.')).toEqual([{ code: 'SAVED_VIEW_SESSION_NOT_EXPLAINED' }]);
  });
  it('accepts feedback that explains the session ended, in English and French', () => {
    expect(classifySavedViewFeedback('Your session has ended. Sign in again to save this view.')).toEqual([]);
    expect(classifySavedViewFeedback('Votre session a expiré. Reconnectez-vous pour enregistrer cette vue.')).toEqual([]);
  });
  it('targets the Posts screen', () => expect(SAVED_VIEW_ROUTE).toBe('/content'));
});
