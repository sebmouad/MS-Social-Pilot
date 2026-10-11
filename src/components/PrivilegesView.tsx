import { getFormatter, getTranslations } from 'next-intl/server';

import { CAPABILITIES, ROLES_BY_RANK, atLeast, type Capability } from '@/lib/constants';
import type { privilegesByMember } from '@/lib/root';

/**
 * Who may do what, printed from the same `CAPABILITIES` table the permission
 * checks read, then every member with their role, Page access and last
 * sign-in. For the owner's audit (docs/ai/PERMISSIONS.md).
 */
export async function PrivilegesView({
  members,
  showWorkspace,
}: {
  members: Awaited<ReturnType<typeof privilegesByMember>>;
  showWorkspace: boolean;
}) {
  const t = await getTranslations('root.privileges');
  const tRoles = await getTranslations('team.roles');
  const format = await getFormatter();
  const capabilities = Object.keys(CAPABILITIES) as Capability[];

  return (
    <div className="space-y-6">
      <section className="card p-0">
        <h2 className="px-4 pt-4 text-sm font-semibold text-slate-900">{t('matrix')}</h2>
        <div className="scroll-x px-4 pb-4">
          <table className="mt-3 w-full min-w-[32rem] text-left text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="py-2 pr-3 font-medium">{t('capability')}</th>
                {ROLES_BY_RANK.map((role) => (
                  <th key={role} className="px-2 py-2 text-center font-medium">{tRoles(role)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {capabilities.map((capability) => (
                <tr key={capability}>
                  <td className="py-2 pr-3 text-slate-900">{t(`capabilities.${capability}`)}</td>
                  {ROLES_BY_RANK.map((role) => {
                    const allowed = atLeast(role, CAPABILITIES[capability]);
                    return (
                      <td key={role} className="px-2 py-2 text-center">
                        <span className={allowed ? 'text-emerald-700' : 'text-slate-400'}>{allowed ? '✓' : '—'}</span>
                        <span className="sr-only">{allowed ? t('yes') : t('no')}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-slate-500">{t('rootNote')}</p>
        </div>
      </section>

      <section className="card p-0">
        <h2 className="px-4 pt-4 text-sm font-semibold text-slate-900">{t('members', { count: members.length })}</h2>
        <div className="scroll-x px-4 pb-4">
          <table className="mt-3 w-full min-w-[40rem] text-left text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                {showWorkspace && <th className="py-2 pr-3 font-medium">{t('workspace')}</th>}
                <th className="py-2 pr-3 font-medium">{t('person')}</th>
                <th className="py-2 pr-3 font-medium">{t('role')}</th>
                <th className="py-2 pr-3 font-medium">{t('pages')}</th>
                <th className="py-2 font-medium">{t('lastSignIn')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {members.map((member, index) => (
                <tr key={`${member.workspace}-${member.email}-${index}`}>
                  {showWorkspace && <td className="py-2 pr-3 text-slate-600">{member.workspace}</td>}
                  <td className="py-2 pr-3">
                    <span className="font-medium text-slate-900">{member.name}</span>
                    <span className="block text-xs text-slate-500">{member.email}</span>
                  </td>
                  <td className="py-2 pr-3 text-slate-700">
                    {tRoles(member.role)}
                    {member.isRoot && <span className="badge ml-1 bg-amber-100 text-amber-800">{t('root')}</span>}
                    {member.disabled && <span className="badge ml-1 bg-red-100 text-red-700">{t('disabled')}</span>}
                  </td>
                  <td className="py-2 pr-3 text-slate-600">{member.pages === null ? t('allPages') : t('somePages', { count: member.pages })}</td>
                  <td className="py-2 text-slate-600">
                    {member.lastSignIn ? format.dateTime(new Date(member.lastSignIn), { dateStyle: 'medium' }) : t('never')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
