import type { ModuleManifest } from '../types';

/**
 * AI studio: content generation (pictures, video, voice, writing assist, translations, checks),
 * writing agents with scheduled runs, and caption tests. URLs are unchanged: the Content tabs
 * /content/ai-studio and /content/agents plus /content/tests (Caption tests, moved from Insights 2026-11-14). Key namespace is not ownership: the caption
 * schedule key keeps its `publishing.*` name so stored Root values keep working.
 */
export const studioManifest = {
  id: 'studio',
  area: 'content',
  health: { configuration: true, jobHistory: true, pendingQueues: [] },
  jobs: [
    { name: 'scheduledAgents', label: 'Scheduled writing runs', configKey: 'agents.scheduledRunsSchedule' },
    { name: 'captionTests', label: 'Caption test results', configKey: 'publishing.captionTestsSchedule' },
    { name: 'aiVideos', label: 'AI video progress', configKey: 'ai.videoSchedule' },
  ],
  rootSettingsPrefixes: ['agents.', 'ai.', 'captionTests.'],
  rootSettingKeys: ['publishing.captionTestsSchedule'],
  title: 'AI studio',
  href: '/content/ai-studio',
  redirects: [
    { from: '/publishing/ai-studio', to: '/content/ai-studio' },
    { from: '/agents', to: '/content/agents' },
    { from: '/analytics/tests', to: '/content/tests' },
    { from: '/insights/tests', to: '/content/tests' },
  ],
  pages: [
    { id: 'studio/ai-studio', title: 'AI studio', href: '/content/ai-studio', description: 'Generate images, video and voice, and check a post before publishing.' },
    { id: 'studio/agents', title: 'Writing agents', href: '/content/agents', description: 'Save a writing brief and prepare suggestions for review.' },
    { id: 'studio/tests', title: 'Caption tests', href: '/content/tests', description: 'Test captions against each other and learn what works.' },
  ],
} as const satisfies ModuleManifest;
