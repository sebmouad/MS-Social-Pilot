vi.mock('server-only', () => ({}));
vi.mock('@/modules/settings/channel-profiles/service', () => ({ readChannelProfiles: async () => ({ channels: [], groups: [] }) }));
import { describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactNode } from 'react';

vi.mock('@/server/context', () => ({ requireViewer: async () => ({ permissions: {}, entitlements: {}, user: { id: 'user', name: 'Example author' }, workspaceId: 'workspace', membership: { workspace: { timezone: 'UTC' } } }) }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'accept-language': 'fr-FR' }) }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: () => true }));
vi.mock('@/server/entitlements', () => ({ canUseFeature: () => false }));
vi.mock('@/modules/publishing/server/templates', () => ({ readTemplatePage: vi.fn() }));
vi.mock('@/modules/publishing/server/destinations', () => ({ publishingDestinationChoices: async () => [] }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => key === 'publishing.uiCopy' ? (await import('@/modules/publishing/ui/kit/copy')).publishingCopyDefaults : key === 'publishing.actionCopy' ? (await import('@/modules/publishing/action-catalog')).publishingActionCopy : key === 'publishing.composerCopy' ? (await import('@/modules/publishing/composer-catalog')).composerCatalogDefaults : ({
  'publishing.allowedImageMimeTypes': ['image/png'], 'publishing.maxImageUploadBytes': 5000,
  'publishing.maxImageAltCharacters': 120, 'publishing.maxMessageCharacters': 500,
  'publishing.maxRemoteMediaPerPost': 6, 'publishing.maxFirstCommentDelayMinutes': 45,
}[key]) }));
vi.mock('@/components/PostPreview', () => ({ formatPostPreviewTime: () => 'Example time' }));
vi.mock('../src/modules/publishing/ui/publishing-ui', () => ({ PageHeading: () => null }));
vi.mock('../src/modules/publishing/ui/compose/PostComposer', () => ({ PostComposer: () => null }));
import ComposePage from '../src/modules/publishing/ui/compose/ComposeScreen';
import { PostComposer } from '../src/modules/publishing/ui/compose/PostComposer';

function propsFor(node: ReactNode): Record<string, any> | undefined {
  if (Array.isArray(node)) return node.map(propsFor).find(Boolean);
  if (!isValidElement<{ children?: ReactNode }>(node)) return;
  if (node.type === PostComposer) return node.props;
  return propsFor(node.props.children);
}

describe('composer Root configuration wiring', () => {
  it('keeps the delay ceiling independent from the media limit', async () => {
    const props = propsFor(await ComposePage({ searchParams: Promise.resolve({}) }));
    expect(props?.maxFirstCommentDelayMinutes).toBe(45);
    expect(props?.imageRules.maxMedia).toBe(6);
    expect(props?.imageRules.maxMessageCharacters).toBe(500);
    expect(props?.aiLocale).toBe('fr');
  });
});
