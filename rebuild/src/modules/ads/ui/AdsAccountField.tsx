'use client';
import { useInsightsParam } from '@/modules/analytics/ui/insights/InsightsFilterRow';

/** Ad-account switcher inside the Ads filter button: `account=<id>` in the address, empty for all accounts. */
export function AdsAccountField({ accounts, label, allLabel }: { accounts: Array<{ id: string; name: string }>; label: string; allLabel: string }) {
  const [account, setAccount] = useInsightsParam('account');
  return <label>{label}
    <select className="ui-input" value={account} onChange={event => setAccount(event.currentTarget.value)}>
      <option value="">{allLabel}</option>
      {accounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
  </label>;
}
