'use client';
import { useState, type ComponentProps } from 'react';
import { AccountManager } from './manager';
import { AccountSecurity } from './security';
/** Profile tab: name and email. Security tab: password, sessions, two-step and passkeys; the session list refreshes after a credential change. */
export function AccountSettings(props: ComponentProps<typeof AccountManager>) {
  const [revision, setRevision] = useState(0);
  if (props.part !== 'security') return <AccountManager {...props} />;
  return <><AccountManager {...props} sessionRevision={revision} /><AccountSecurity canWrite={props.canWrite} accountName={props.email} locale={props.locale ?? 'en'} onChanged={() => setRevision(value => value + 1)} /></>;
}
