import {
  IconAd2, IconAddressBook, IconAffiliate, IconApi, IconBell, IconBolt, IconBriefcase, IconBuildingStore, IconCalendarEvent,
  IconChartBar, IconChartDots3, IconChartPie, IconCheckbox, IconCircleDot, IconClipboardCheck, IconColumns3, IconDatabase,
  IconFileAnalytics, IconHome, IconId, IconLayoutDashboard, IconLink, IconListDetails, IconMessageCircle, IconPalette, IconPhoto,
  IconPlugConnected, IconRss, IconSend, IconSettings, IconShare, IconShieldLock, IconSpeakerphone, IconStack2, IconTag,
  IconTarget, IconTemplate, IconUserCircle, IconUsers, IconUsersGroup, IconVersions, IconWebhook, IconPin, IconScale, IconHistory, IconSparkles, IconFlask,
  type Icon as TablerIcon,
} from '@tabler/icons-react';

/** Module identity icons; each module also has a `--mod-<id>` theme color. */
export const MODULE_ICONS: Record<string, TablerIcon> = {
  home: IconHome, publishing: IconSend, inbox: IconMessageCircle, analytics: IconChartBar, ads: IconSpeakerphone,
  tasks: IconCheckbox, agency: IconBriefcase, settings: IconSettings, root: IconShieldLock,
};

/** Page icons keyed by route; unknown routes fall back to a neutral dot. */
export const PAGE_ICONS: Record<string, TablerIcon> = {
  '/home': IconLayoutDashboard,
  '/content': IconListDetails, '/content/calendar': IconCalendarEvent, '/content/queue': IconStack2,
  '/content/approvals': IconClipboardCheck, '/content/library': IconPhoto, '/content/feeds': IconRss, '/content/ai-studio': IconSparkles,
  '/content/library/fields': IconColumns3, '/content/library/labels': IconTag, '/content/library/templates': IconTemplate,
  '/inbox': IconMessageCircle,
  '/insights': IconChartBar, '/insights/explore': IconChartPie, '/insights/audience': IconUsersGroup, '/insights/compare': IconScale,
  '/ads/analysis': IconChartPie, '/insights/posts': IconChartDots3, '/insights/tests': IconFlask, '/insights/goals': IconTarget,
  '/insights/pins': IconPin, '/insights/reports': IconFileAnalytics,
  '/ads': IconAd2, '/ads/compare': IconScale, '/ads/manage': IconAffiliate, '/ads/campaigns': IconBolt,
  '/tasks': IconCheckbox, '/agency': IconBuildingStore, '/agency/clients': IconAddressBook,
  '/settings/channels': IconPlugConnected, '/settings/team': IconUsers, '/settings/workspace': IconId,
  '/settings/sharing': IconShare, '/settings/sharing/bio': IconLink, '/settings/integrations': IconApi, '/settings/integrations/webhooks': IconWebhook,
  '/settings/account': IconUserCircle, '/settings/account/notifications': IconBell, '/settings/data': IconDatabase,
  '/settings/account/appearance': IconPalette, '/settings/history': IconHistory, '/settings/profiles': IconVersions,
};

export function ModuleGlyph({ id, size = 19 }: { id: string; size?: number }) {
  const Glyph = MODULE_ICONS[id] ?? IconCircleDot;
  return <Glyph size={size} stroke={1.75} aria-hidden="true" />;
}

export function PageGlyph({ href, size = 17 }: { href: string; size?: number }) {
  const Glyph = PAGE_ICONS[href] ?? IconCircleDot;
  return <Glyph size={size} stroke={1.75} aria-hidden="true" />;
}
