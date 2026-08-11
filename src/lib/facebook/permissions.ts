import { graphRequest } from './graph';

/**
 * What Facebook has and has not agreed to, in words a person can act on.
 *
 * `/me/permissions` is the authoritative list, and it says more than the token
 * does: a permission that was *declined* appears there, where the token simply
 * lacks it. The difference matters on screen, because "you unticked this" and
 * "this was never asked for" have different fixes — one is a reconnect, the
 * other is a configuration change.
 */

export type PermissionStatus = 'granted' | 'declined' | 'not_requested';

export interface PermissionState {
  permission: string;
  status: PermissionStatus;
  /** True when this app cannot do its job without it. */
  required: boolean;
  /** What it lets the app do, for someone who has never read Meta's docs. */
  label: string;
  /** What stops working without it. */
  consequence: string;
}

/**
 * Every permission this app ever asks for.
 *
 * Written out rather than generated because the value here is entirely in the
 * wording: `pages_read_engagement` tells a person nothing, and "Read your
 * Pages' posts and their statistics" tells them whether they meant to refuse
 * it.
 */
const CATALOGUE: Record<string, { label: string; consequence: string }> = {
  public_profile: {
    label: 'Know who you are',
    consequence: 'Facebook always grants this; without it nothing works at all.',
  },
  email: {
    label: 'See your email address',
    consequence: 'Only used to label the connection on this screen.',
  },
  pages_show_list: {
    label: 'See the list of Pages you manage',
    consequence: 'No Pages can be found or connected.',
  },
  pages_read_engagement: {
    label: "Read your Pages' posts, comments and statistics",
    consequence: 'Analytics and the comment inbox stay empty.',
  },
  pages_manage_posts: {
    label: 'Publish and schedule posts on your Pages',
    consequence: 'Nothing can be published. This is the one that matters most.',
  },
  pages_manage_engagement: {
    label: 'Hide, delete and reply to comments on your Pages',
    consequence: 'Comments can be read but not moderated.',
  },
  read_insights: {
    label: "Read your Pages' insights",
    consequence: 'Reach, impressions and follower figures stay empty.',
  },
  pages_manage_metadata: {
    label: "Read your Pages' settings and message threads",
    consequence: 'The Page inbox cannot be synced.',
  },
  pages_messaging: {
    label: 'Read and send Page messages',
    consequence: 'The Page inbox stays empty.',
  },
  publish_to_groups: {
    label: 'Publish posts to your Groups',
    consequence: 'Nothing can be published to a Group.',
  },
  groups_access_member_info: {
    label: 'See who is in your Groups',
    consequence: 'Group posts can still be published; member counts are missing.',
  },
  instagram_basic: {
    label: 'See the Instagram accounts linked to your Pages',
    consequence: 'Instagram accounts cannot be found.',
  },
  instagram_manage_insights: {
    label: 'Read your Instagram statistics',
    consequence: 'Instagram analytics stay empty.',
  },
  ads_read: {
    label: 'Read your advertising results',
    consequence: 'Ad spend and campaign figures stay empty.',
  },
  business_management: {
    label: 'See the Business accounts you belong to',
    consequence: 'Some Pages owned by a Business may not be found.',
  },
};

export function describePermission(permission: string): { label: string; consequence: string } {
  return (
    CATALOGUE[permission] ?? {
      label: permission,
      consequence: 'This app does not use this permission.',
    }
  );
}

/**
 * Ask Facebook what it granted, and fold in what this app asked for.
 *
 * A permission the app requires but Facebook has never heard of comes back as
 * `not_requested` rather than being dropped, because its absence is the whole
 * point: it is the reason something on this screen is not working.
 */
export async function readPermissions(
  accessToken: string,
  required: string[],
): Promise<PermissionState[]> {
  const { data } = await graphRequest<{
    data?: Array<{ permission: string; status: string }>;
  }>('me/permissions', { accessToken });

  const reported = new Map((data.data ?? []).map((row) => [row.permission, row.status]));
  const names = new Set([...reported.keys(), ...required]);

  return [...names]
    .map((permission) => {
      const status = reported.get(permission);
      return {
        permission,
        status: (status === 'granted'
          ? 'granted'
          : status === 'declined'
            ? 'declined'
            : 'not_requested') as PermissionStatus,
        required: required.includes(permission),
        ...describePermission(permission),
      };
    })
    .sort((a, b) => {
      // Problems first, then required, then alphabetically: the list is read
      // top-down by someone trying to find out what is wrong.
      const rank = (state: PermissionState) =>
        state.required && state.status !== 'granted' ? 0 : state.required ? 1 : 2;
      return rank(a) - rank(b) || a.permission.localeCompare(b.permission);
    });
}
