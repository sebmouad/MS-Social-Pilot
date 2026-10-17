import EnrollSecondStepPage from './enroll-form';
import { postAuthenticationPath } from '@/server/invitation-session';

export default async function EnrollSecondStepRoute() {
  return <EnrollSecondStepPage continuePath={await postAuthenticationPath()} />;
}
