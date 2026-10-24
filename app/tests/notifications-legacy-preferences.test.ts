import { describe, expect, it } from 'vitest';
import { notificationPreferenceUpdateSchema, notificationConfirmation } from '../src/modules/settings/notifications/contracts';
import { ADDITIONAL_NOTIFICATION_PREFERENCES, notificationPreferenceLabels } from '../src/modules/settings/notifications/catalog';

describe('legacy personal alert preferences', () => {
  it.each(ADDITIONAL_NOTIFICATION_PREFERENCES)('accepts an independent opt-out for %s', key => {
    expect(notificationPreferenceUpdateSchema.parse({ [key]: false, confirmation: notificationConfirmation.updatePreferences() })).toEqual({ [key]: false, confirmation: notificationConfirmation.updatePreferences() });
  });
  it('rejects unknown flags, non-booleans and empty changes', () => {
    for (const input of [{ onTokenExpiry: 'false' }, { onUnknown: true }, {}]) {
      expect(notificationPreferenceUpdateSchema.safeParse({ ...input, confirmation: notificationConfirmation.updatePreferences() }).success).toBe(false);
    }
  });
  it('provides English and French labels for every additional personal switch', () => {
    for (const key of ADDITIONAL_NOTIFICATION_PREFERENCES) {
      expect(notificationPreferenceLabels.en[key].length).toBeGreaterThan(0);
      expect(notificationPreferenceLabels.fr[key].length).toBeGreaterThan(0);
      expect(notificationPreferenceLabels.en[key]).not.toBe(notificationPreferenceLabels.fr[key]);
    }
  });
});
