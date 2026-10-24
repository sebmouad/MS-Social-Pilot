export function remotePlatformName(post: { targets: Array<{ status: string; target: { platformName?: string | null } }> }) {
  const names = [...new Set(post.targets.filter(row => row.status === 'scheduled_remote').flatMap(row => row.target.platformName ? [row.target.platformName] : []))];
  return names.length ? names.join(' + ') : undefined;
}

