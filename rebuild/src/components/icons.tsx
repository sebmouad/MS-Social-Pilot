import {
  IconAd2, IconAddressBook, IconAffiliate, IconApi, IconBell, IconBolt, IconBriefcase, IconBuildingStore, IconCalendarEvent,
  IconChartBar, IconChartDots3, IconChartPie, IconCheckbox, IconCircleDot, IconClipboardCheck, IconColumns3, IconDatabase,
  IconFileAnalytics, IconHome, IconId, IconLayoutDashboard, IconLink, IconListDetails, IconMessageCircle, IconPalette, IconPhoto,
  IconPlugConnected, IconRss, IconSend, IconSettings, IconShare, IconShieldLock, IconSpeakerphone, IconStack2, IconTag,
  IconTarget, IconTemplate, IconUserCircle, IconUsers, IconUsersGroup, IconVersions, IconWebhook, IconPin, IconScale,
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
  '/publishing/posts': IconListDetails, '/publishing/calendar': IconCalendarEvent, '/publishing/queue': IconStack2,
  '/publishing/approvals': IconClipboardCheck, '/publishing/media': IconPhoto, '/publishing/feeds': IconRss,
  '/publishing/collaboration': IconColumns3, '/publishing/labels': IconTag, '/publishing/templates': IconTemplate,
  '/inbox': IconMessageCircle,
  '/analytics': IconChartBar, '/analytics/demographics': IconUsersGroup, '/analytics/compare': IconScale,
  '/analytics/ads': IconChartPie, '/analytics/posts': IconChartDots3, '/analytics/goals': IconTarget,
  '/analytics/pins': IconPin, '/analytics/reports': IconFileAnalytics,
  '/ads': IconAd2, '/ads/compare': IconScale, '/ads/objects': IconAffiliate, '/ads/campaigns': IconBolt,
  '/tasks': IconCheckbox, '/agency': IconBuildingStore, '/agency/clients': IconAddressBook,
  '/settings/connections': IconPlugConnected, '/settings/team': IconUsers, '/settings/workspace': IconId,
  '/settings/sharing': IconShare, '/settings/bio': IconLink, '/settings/mcp': IconApi, '/settings/webhooks': IconWebhook,
  '/settings/account': IconUserCircle, '/settings/notifications': IconBell, '/settings/data': IconDatabase,
  '/settings/appearance': IconPalette, '/settings/profiles': IconVersions,
};

export function ModuleGlyph({ id, size = 19 }: { id: string; size?: number }) {
  const Glyph = MODULE_ICONS[id] ?? IconCircleDot;
  return <Glyph size={size} stroke={1.75} aria-hidden="true" />;
}

export function PageGlyph({ href, size = 17 }: { href: string; size?: number }) {
  const Glyph = PAGE_ICONS[href] ?? IconCircleDot;
  return <Glyph size={size} stroke={1.75} aria-hidden="true" />;
}
