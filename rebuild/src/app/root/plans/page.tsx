import { synchronousPolicy } from '@/lib/config/synchronous-policy';
import { requireRootPage } from '@/server/config/access';
import { RootFrame } from '@/server/root/RootFrame';
import { listRootPlanHistory, listRootPlans, listRootSubscribers } from '@/server/root/legacy/plans';
import { PlanEditor } from './PlanEditor';
import { AssignPlan } from './AssignPlan';
import './legacy-ops.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Plans · Root' };

export default async function RootPlansPage() {
  const actor = await requireRootPage();
  const loaded = await Promise.all([listRootPlans(actor.id), listRootPlanHistory(actor.id), listRootSubscribers(actor.id)]).catch(() => null);
  return <RootFrame active="/root/plans"><div className="root-ops">
    <header className="root-control__heading">
      <p className="root-config__eyebrow">Root · Shared controls</p>
      <h1>Plans</h1>
      <p>Plans set limits and the module features an account can use. Prices are displayed only; no payment is taken here. Every change needs an exact confirmation and is recorded in installation activity.</p>
    </header>
    {!loaded ? <section className="root-control__notice" role="alert"><h2>Plans unavailable</h2><p>The plan catalog could not be loaded. Check database availability and try again.</p></section> : (() => {
      const [{ plans, featureGroups, truncated: plansCut, limit: planLimit }, history, { items: subscribers, truncated: subsCut, limit: subLimit }] = loaded;
      return <>
        {plans.length === 0 && <section className="root-control__panel"><h2>No plans</h2><p>No subscription plans exist in this installation. Accounts run without plan limits.</p></section>}
        {plansCut && <p className="root-ops__muted" role="status">Showing the first {planLimit} plans. Raise the plan catalog limit in Root settings to see more.</p>}
        {plans.map(plan => <div key={plan.id}>
          <p className="root-ops__muted">{plan.subscribers ?? 0} {plan.subscribers === 1 ? 'account' : 'accounts'}{plan.isDefault ? ' · default for new sign-ups' : ''}</p>
          <PlanEditor plan={plan} groups={featureGroups} nameMaxCharacters={synchronousPolicy('root.planNameMaxCharacters')} />
        </div>)}
        <section className="root-ops__panel" aria-labelledby="subscribers"><h2 id="subscribers">Subscribers</h2>
          {subsCut && <p className="root-ops__muted" role="status">Showing the first {subLimit} accounts. Raise the subscriber limit in Root settings to assign plans to others.</p>}
          {subscribers.length === 0 ? <p className="root-ops__muted">No account owns a workspace yet.</p> : <div className="root-ops__table" role="region" aria-label="Subscribers" tabIndex={0}><table>
            <caption className="ui-visually-hidden">Accounts that own workspaces and their plans</caption>
            <thead><tr><th scope="col">Account</th><th scope="col">Workspaces owned</th><th scope="col">Plan</th></tr></thead>
            <tbody>{subscribers.map(user => <tr key={user.id}><td><strong>{user.name}</strong><br />{user.email}{user.isInstanceOwner ? ' · installation owner' : ''}{user.disabled ? ' · disabled' : ''}</td><td>{user.workspaces}</td><td><AssignPlan userId={user.id} email={user.email} current={user.planKey} plans={plans} /></td></tr>)}</tbody>
          </table></div>}
        </section>
        <section className="root-ops__panel" aria-labelledby="plan-history"><h2 id="plan-history">Plan history</h2>
          {history.items.length === 0 ? <p className="root-ops__muted">No plan changes recorded.</p> : <div className="root-ops__table" role="region" aria-label="Plan history" tabIndex={0}><table>
            <caption className="ui-visually-hidden">Recent plan edits and assignments</caption>
            <thead><tr><th scope="col">When</th><th scope="col">Change</th><th scope="col">By</th></tr></thead>
            <tbody>{history.items.map(item => <tr key={item.id}><td><time dateTime={item.at}>{new Date(item.at).toLocaleString()}</time></td>
              <td>{item.action === 'root.plan_assigned' ? `${item.subject ?? 'Account'}: ${item.fromPlan ?? 'no plan'} → ${item.toPlan ?? 'no plan'}` : `${item.plan ?? 'Plan'} edited${item.changes.length ? ` (${item.changes.join(', ')})` : ''}`}</td>
              <td>{item.actor ?? 'Unknown'}</td></tr>)}</tbody>
          </table></div>}
        </section>
      </>;
    })()}
  </div></RootFrame>;
}
