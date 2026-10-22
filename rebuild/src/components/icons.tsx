import {
  IconAd2, IconAddressBook, IconAffiliate, IconApi, IconBell, IconBolt, IconBriefcase, IconBuildingStore, IconCalendarEvent,
  IconChartBar, IconChartDots3, IconChartPie, IconCheckbox, IconCircleDot, IconClipboardCheck, IconColumns3, IconDatabase,
  IconFileAnalytics, IconHome, IconId, IconLayoutDashboard, IconLink, IconListDetails, IconMessageCircle, IconPalette, IconPhoto,
  IconPlugConnected, IconRss, IconSend, IconSettings, IconShare, IconShieldLock, IconSpeakerphone, IconStack2, IconTag,
  IconTarget, IconTemplate, IconUserCircle, IconUsers, IconUsersGroup, IconVersions, IconWebhook, IconPin, IconScale, IconHistory,
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
  '/content/approvals': IconClipboardCheck, '/content/library': IconPhoto, '/content/library/feeds': IconRss,
  '/content/library/fields': IconColumns3, '/content/library/labels': IconTag, '/content/library/templates': IconTemplate,
  '/inbox': IconMessageCircle,
  '/insights': IconChartBar, '/insights/explore': IconChartPie, '/insights/audience': IconUsersGroup, '/insights/compare': IconScale,
  '/insights/ads/analysis': IconChartPie, '/insights/posts': IconChartDots3, '/insights/goals': IconTarget,
  '/insights/pins': IconPin, '/insights/reports': IconFileAnalytics,
  '/insights/ads': IconAd2, '/insights/compare/ads': IconScale, '/insights/ads/manage': IconAffiliate, '/insights/ads/campaigns': IconBolt,
  '/tasks': IconCheckbox, '/agency': IconBuildingStore, '/agency/clients': IconAddressBook,
  '/settings/connections': IconPlugConnected, '/settings/team': IconUsers, '/settings/workspace': IconId,
  '/settings/sharing': IconShare, '/settings/bio': IconLink, '/settings/mcp': IconApi, '/settings/webhooks': IconWebhook,
  '/settings/account': IconUserCircle, '/settings/notifications': IconBell, '/settings/data': IconDatabase,
  '/settings/appearance': IconPalette, '/settings/history': IconHistory, '/settings/profiles': IconVersions,
};

export function ModuleGlyph({ id, size = 19 }: { id: string; size?: number }) {
  const Glyph = MODULE_ICONS[id] ?? IconCircleDot;
  return <Glyph size={size} stroke={1.75} aria-hidden="true" />;
}

export function PageGlyph({ href, size = 17 }: { href: string; size?: number }) {
  const Glyph = PAGE_ICONS[href] ?? IconCircleDot;
  return <Glyph size={size} stroke={1.75} aria-hidden="true" />;
}
