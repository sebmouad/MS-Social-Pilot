'use client';

import { useState } from 'react';
import { planConfirmation } from '@/modules/root/server/admin/shared';
import { ConfirmAction } from './ConfirmAction';

export function AssignPlan({ userId, email, current, plans }: { userId: string; email: string; current: string | null; plans: readonly { key: string; name: string }[] }) {
  const [choice, setChoice] = useState(current ?? '');
  const planKey = choice === '' ? null : choice;
  const phrase = planKey ? planConfirmation.assign(planKey, email) : planConfirmation.unassign(email);
  return <div className="root-ops__actions">
    <label className="ui-field"><span className="ui-visually-hidden">Plan for {email}</span>
      <select className="ui-input" value={choice} onChange={event => setChoice(event.target.value)}>
        <option value="">No plan (no limits)</option>
        {plans.map(plan => <option key={plan.key} value={plan.key}>{plan.name}</option>)}
      </select></label>
    <ConfirmAction id={`assign-${userId}`} label="Assign" title={`Change plan for ${email}?`} description={planKey ? 'Limits and features of the selected plan apply to every workspace this account owns.' : 'This account will have no plan limits.'} phrase={phrase} endpoint="/api/root/plans/assign" body={{ userId, planKey }} variant="primary" successText="Plan assignment saved." disabled={(current ?? '') === choice} />
  </div>;
}
