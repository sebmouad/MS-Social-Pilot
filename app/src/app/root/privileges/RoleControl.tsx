'use client';

import { useState } from 'react';
import { roleConfirmation, WORKSPACE_ROLES } from '@/modules/root/server/admin/shared';
import { ConfirmAction } from '../plans/ConfirmAction';

export function RoleControl({ membershipId, email, workspaceId, workspace, role }: { membershipId: string; email: string; workspaceId: string; workspace: string; role: string }) {
  const [next, setNext] = useState(role);
  return <div className="root-ops__actions">
    <label className="ui-field"><span className="ui-visually-hidden">Role for {email} in {workspace}</span>
      <select className="ui-input" value={next} onChange={event => setNext(event.target.value)}>{WORKSPACE_ROLES.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
    <ConfirmAction id={`role-${membershipId}`} label="Change role" title={`Change ${email} to ${next}?`} description={`Changes the role in ${workspace} only. Permissions follow the new role immediately. The last active owner of a workspace cannot be demoted.`} phrase={roleConfirmation(email, workspaceId, next)} endpoint="/api/root/privileges" body={{ membershipId, role: next }} variant="primary" successText="Role changed." disabled={next === role} />
  </div>;
}
