import { IconAd2, IconAlertTriangle, IconCheck, IconChartBar, IconHelpCircle, IconKey, IconMessageCircle, IconSend, IconShieldCheck, IconUsers, type Icon } from '@tabler/icons-react';
import type { GrantGroupHealth, GrantGroupState } from '@/lib/connection-health';
import { fill } from '@/modules/settings/ui/shell-copy';
import { grantChipCopy, type GrantChipLocale } from './grant-copy';
import styles from './connections.module.css';

/** Neutral keyword match on the module's group id; the module still owns every label. */
const CAPABILITY_ICONS: Array<[RegExp, Icon]> = [
  [/publish|post|content|schedul/i, IconSend],
  [/message|inbox|comment|conversation|reply/i, IconMessageCircle],
  [/insight|analytic|metric|report/i, IconChartBar],
  [/ad|campaign|billing/i, IconAd2],
  [/page|profile|account|member|audience|people|user/i, IconUsers],
];
const capabilityIcon = (id: string): Icon => CAPABILITY_ICONS.find(([pattern]) => pattern.test(id))?.[1] ?? IconKey;
const STATE_ICON: Record<GrantGroupState, Icon> = { granted: IconCheck, missing: IconAlertTriangle, unknown: IconHelpCircle };
const ORDER: GrantGroupState[] = ['missing', 'unknown', 'granted'];

/**
 * Compact permission summary for one connection: a count chip that opens the full
 * grouped list (native disclosure, no client script).
 */
export function GrantChips({ grants, locale, label }: { grants: readonly GrantGroupHealth[]; locale: GrantChipLocale; label: string }) {
  if (!grants.length) return null;
  const t = grantChipCopy[locale];
  const allowed = grants.filter(group => group.state === 'granted').length;
  const worst: GrantGroupState = grants.some(group => group.state === 'missing') ? 'missing' : grants.some(group => group.state === 'unknown') ? 'unknown' : 'granted';
  const stateLabel: Record<GrantGroupState, string> = { granted: t.allowed, missing: t.missing, unknown: t.unknown };
  const SummaryIcon = worst === 'granted' ? IconShieldCheck : STATE_ICON[worst];
  const summary = fill(t.summary, { allowed, total: grants.length });
  return <details className={styles.grants} aria-label={label}>
    <summary className={styles.grantSummary} data-state={worst} aria-label={`${summary}. ${t.details}`}>
      <SummaryIcon size={14} stroke={2} aria-hidden="true" />{summary}
    </summary>
    <div className={styles.grantGroups} role="group" aria-label={t.list}>
      {ORDER.map(state => {
        const items = grants.filter(group => group.state === state);
        if (!items.length) return null;
        const Mark = STATE_ICON[state];
        return <div key={state} className={styles.grantGroup}>
          <p className={styles.grantGroupLabel}>{stateLabel[state]}</p>
          <ul className={styles.grantList}>{items.map(group => {
            const Glyph = capabilityIcon(group.id);
            return <li key={group.id} className={styles.grantChip} data-state={state}><Glyph size={13} stroke={1.9} aria-hidden="true" />{group.label}<Mark size={12} stroke={2.4} aria-hidden="true" className={styles.grantMark} /><span className="ui-visually-hidden">: {stateLabel[state]}</span></li>;
          })}</ul>
        </div>;
      })}
    </div>
  </details>;
}
