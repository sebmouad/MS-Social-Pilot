import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PublishingChannelOptions } from '../src/app/publishing/PublishingChannelOptions';
describe('shared Publishing channel options', () => {
  it('retains an unavailable URL value with honest copy and no hidden channel metadata', () => {
    const markup = renderToStaticMarkup(createElement('select', { defaultValue: 'hidden-channel' }, createElement(PublishingChannelOptions, { selected: 'hidden-channel', channels: [{ id: 'selected-channel', name: 'Selected channel' }] })));
    expect(markup).toContain('<option value="hidden-channel" selected="">Unavailable channel</option>');
    expect(markup).toContain('All selected channels');
    expect(markup).not.toContain('Hidden channel name');
  });
  it('shows selected channels without a redundant unavailable option', () => {
    const markup = renderToStaticMarkup(createElement('select', { defaultValue: 'selected' }, createElement(PublishingChannelOptions, { selected: 'selected', channels: [{ id: 'selected', name: 'Example channel' }] })));
    expect(markup).not.toContain('Unavailable channel');
    expect(markup).toContain('<option value="selected" selected="">Example channel</option>');
  });
});
