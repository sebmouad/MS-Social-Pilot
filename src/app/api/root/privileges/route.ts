import { NextResponse } from 'next/server';

import { requireRootApi } from '@/lib/auth';
import { route } from '@/lib/api';
import { toCsv } from '@/lib/csv';
import { privilegesByMember } from '@/lib/root';

/** Every member of every workspace with role, Page access and last sign-in, as CSV. Root only. */
export const GET = route(async () => {
  await requireRootApi();
  const rows = await privilegesByMember();
  const csv = toCsv([
    ['workspace', 'name', 'email', 'role', 'root', 'disabled', 'pages', 'last_sign_in'],
    ...rows.map((row) => [
      row.workspace,
      row.name,
      row.email,
      row.role,
      row.isRoot ? 'yes' : 'no',
      row.disabled ? 'yes' : 'no',
      row.pages === null ? 'all' : String(row.pages),
      row.lastSignIn ?? '',
    ]),
  ]);
  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="privileges.csv"',
    },
  });
});
