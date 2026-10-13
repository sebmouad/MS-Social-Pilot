import { redirect } from 'next/navigation';

import { WelcomeWizard } from '@/components/WelcomeWizard';
import { requirePage } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { screenMetadata } from '@/lib/metadata';
import { prisma } from '@/lib/prisma';
import { timezoneOptions } from '@/lib/time';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('welcome.title');
}

/**
 * First steps after creating a workspace: the basics every
 * other screen depends on — its name, its time zone, who it speaks to — and
 * then the Pages. Nothing here is niche or country-specific; each answer is
 * the user's own, and all of it can be changed later in Settings.
 */
export default async function WelcomePage() {
  const auth = await requirePage();
  // Only someone who may change the workspace's settings has anything to do here.
  if (!canManageSettings(auth.role)) redirect('/dashboard');

  const [workspace, pages] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { id: auth.workspace.id } }),
    prisma.target.count({ where: { workspaceId: auth.workspace.id } }),
  ]);

  // The runtime's list leaves out "UTC", which is where every workspace starts.
  const zones = timezoneOptions();
  if (!zones.includes(workspace.timezone)) zones.unshift(workspace.timezone);

  return (
    <WelcomeWizard
      name={workspace.name}
      timezone={workspace.timezone}
      timezones={zones}
      audience={{
        countries: workspace.audienceCountries,
        languages: workspace.audienceLanguages,
        timezone: workspace.audienceTimezone,
        calendars: workspace.audienceCalendars,
      }}
      pages={pages}
    />
  );
}
