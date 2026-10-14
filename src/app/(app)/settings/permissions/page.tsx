import { redirect } from 'next/navigation';
import { screenMetadata } from '@/lib/metadata';

export function generateMetadata() {
  return screenMetadata('team.title');
}

/** Preserve old bookmarks; permissions now belong to Team and roles. */
export default function PermissionsPage() {
  redirect('/settings/team#permissions');
}
