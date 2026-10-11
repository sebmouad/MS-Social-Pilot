import { describe, expect, it } from 'vitest';

import { chatChannelSchema } from '../src/lib/chat';

/** Chat channels only ever point at Slack's and Telegram's own servers. */
describe('chat channels', () => {
  it('take a real Slack webhook and refuse anything else', () => {
    const ok = chatChannelSchema.safeParse({
      kind: 'slack',
      name: 'team',
      url: 'https://hooks.slack.com/services/T000/B000/XXXXXXXXXXXXXXXXXXXX',
      events: ['publishFailure'],
    });
    expect(ok.success).toBe(true);
    for (const url of ['http://hooks.slack.com/services/T000/B000/XXXXXXXXXXXXXXXXXXXX', 'https://hooks.slack.com.evil.test/services/T000/B000/XXXXXXXXXXXXXXXXXXXX', 'https://169.254.169.254/latest']) {
      expect(chatChannelSchema.safeParse({ kind: 'slack', name: 'x', url, events: ['publishFailure'] }).success).toBe(false);
    }
  });

  it('take a Telegram bot token and chat id in their real shapes', () => {
    const base = { kind: 'telegram', name: 'x', events: ['approvalRequest'] };
    expect(chatChannelSchema.safeParse({ ...base, botToken: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw', chatId: '-1001234567890' }).success).toBe(true);
    expect(chatChannelSchema.safeParse({ ...base, botToken: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw/../x', chatId: '-100' }).success).toBe(false);
    expect(chatChannelSchema.safeParse({ ...base, botToken: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw', chatId: 'not an id' }).success).toBe(false);
  });

  it('need at least one alert', () => {
    expect(
      chatChannelSchema.safeParse({ kind: 'slack', name: 'x', url: 'https://hooks.slack.com/services/T000/B000/XXXXXXXXXXXXXXXXXXXX', events: [] }).success,
    ).toBe(false);
  });
});
