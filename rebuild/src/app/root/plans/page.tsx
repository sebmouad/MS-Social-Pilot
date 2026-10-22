import { DataTable } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { synchronousPolicy } from '@/lib/config/synchronous-policy';
import { requireRootPage } from '@/server/config/access';
import { RootFrame } from '@/modules/root/ui/RootFrame';
import { listRootPlanHistory, listRootPlans, listRootSubscribers } from '@/modules/root/server/admin/plans';
import { PlanEditor } from './PlanEditor';
import { AssignPlan } from './AssignPlan';
import './root-ops.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Plans · Root' };

export default async function RootPlansPage() {
  const actor = await requireRootPage();
  const loaded = await Promise.all([listRootPlans(actor.id), listRootPlanHistory(actor.id), listRootSubscribers(actor.id)]).catch(() => null);
  return <RootFrame active="/root/plans"><div className="root-ops">
    <PageHeader module="root" title="Plans" description={<>Plans set limits and the module features an account can use. Prices are displayed only; no payment is taken here. Every change needs an exact confirmation and is recorded in installation activity.</>} />
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
          {subscribers.length === 0 ? <p className="root-ops__muted">No account owns a workspace yet.</p> : <DataTable caption={'Accounts that own workspaces and their plans'} rows={subscribers} rowKey={user => user.id} columns={[
          { key: 'column0', label: 'Account', render: (user) => <><strong>{user.name}</strong><br />{user.email}{user.isInstanceOwner ? ' · installation owner' : ''}{user.disabled ? ' · disabled' : ''}</> },
          { key: 'column1', label: 'Workspaces owned', render: (user) => <>{user.workspaces}</> },
          { key: 'column2', label: 'Plan', render: (user) => <><AssignPlan userId={user.id} email={user.email} current={user.planKey} plans={plans} /></> }
        ]} />}
        </section>
        <section className="root-ops__panel" aria-labelledby="plan-history"><h2 id="plan-history">Plan history</h2>
          {history.items.length === 0 ? <p className="root-ops__muted">No plan changes recorded.</p> : <DataTable caption={'Recent plan edits and assignments'} rows={history.items} rowKey={item => item.id} columns={[
          { key: 'column0', label: 'When', render: (item) => <><time dateTime={item.at}>{new Date(item.at).toLocaleString()}</time></> },
          { key: 'column1', label: 'Change', render: (item) => <>{item.action === 'root.plan_assigned' ? `${item.subject ?? 'Account'}: ${item.fromPlan ?? 'no plan'} → ${item.toPlan ?? 'no plan'}` : `${item.plan ?? 'Plan'} edited${item.changes.length ? ` (${item.changes.join(', ')})` : ''}`}</> },
          { key: 'column2', label: 'By', render: (item) => <>{item.actor ?? 'Unknown'}</> }
        ]} />}
        </section>
      </>;
    })()}
  </div></RootFrame>;
}
