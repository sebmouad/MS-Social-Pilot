'use client';
import { useState, type ComponentProps } from 'react';
import { AccountManager } from './manager';
import { AccountSecurity } from './security';
/** Refresh the session directory after a credential change revoked other sessions. */
export function AccountSettings(props: ComponentProps<typeof AccountManager>) {
  const [revision, setRevision] = useState(0);
  return <><AccountManager {...props} sessionRevision={revision} /><AccountSecurity canWrite={props.canWrite} accountName={props.email} locale={props.locale ?? 'en'} onChanged={() => setRevision(value => value + 1)} /></>;
}
