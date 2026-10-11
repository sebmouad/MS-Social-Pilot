import QRCode from 'qrcode';

import { requireTwoStepSetupUser } from '@/lib/auth';
import { ok, route } from '@/lib/api';
import { beginTotp } from '@/lib/two-step';

/** A new authenticator-app secret, with the QR code to scan. Kept aside until confirmed. */
export const POST = route(async () => {
  const { userId } = await requireTwoStepSetupUser();
  const { secret, uri } = await beginTotp(userId);
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 192 });
  return ok({ secret, qr });
});
