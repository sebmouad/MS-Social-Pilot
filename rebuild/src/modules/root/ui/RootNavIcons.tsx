import {
  IconActivity, IconAlertTriangle, IconApps, IconBuildingCommunity, IconServer2, IconCreditCard, IconDatabaseExport, IconKey, IconLayoutDashboard,
  IconLock, IconMailPlus, IconPlugConnected, IconPuzzle, IconSettings2, IconShieldCheck, IconSpeakerphone, IconTool, IconUsers, IconWorld,
  type Icon,
} from '@tabler/icons-react';
import { PAGE_ICONS } from '@/components/icons';

/** Icons for Root sidebar pages. Product and platform module pages reuse their own module identity icons. */
const ROOT_PAGE_ICONS: Record<string, Icon> = {
  '/root': IconLayoutDashboard,
  '/root/users': IconUsers,
  '/root/registration': IconMailPlus,
  '/root/workspaces': IconBuildingCommunity,
  '/root/plans': IconCreditCard,
  '/root/privileges': IconKey,
  '/root/lifecycle': IconShieldCheck,
  '/root/sessions': IconLock,
  '/root/connections': IconPlugConnected,
  '/root/errors': IconAlertTriangle,
  '/root/backups': IconDatabaseExport,
  '/root/operations': IconTool,
  '/root/activity': IconActivity,
  '/root/changelog': IconSpeakerphone,
  '/root/config': IconSettings2,
  '/root/modules': IconApps,
  '/root/platforms': IconWorld,
};

const PRODUCT_ICONS: Record<string, string> = { publishing: '/content', inbox: '/inbox', analytics: '/insights', ads: '/insights/ads', home: '/home', tasks: '/tasks', agency: '/agency', settings: '/settings/connections' };

export function rootPageIcon(href: string): Icon {
  const direct = ROOT_PAGE_ICONS[href];
  if (direct) return direct;
  const productId = href.match(/^\/root\/modules\/([^/]+)$/)?.[1];
  if (productId) return (productId && PAGE_ICONS[PRODUCT_ICONS[productId] ?? '']) || IconPuzzle;
  if (href.startsWith('/root/platforms/')) return IconServer2;
  return IconPuzzle;
}

export function RootPageGlyph({ href, size = 17 }: { href: string; size?: number }) {
  const Glyph = rootPageIcon(href);
  return <Glyph size={size} stroke={1.75} aria-hidden="true" />;
}
