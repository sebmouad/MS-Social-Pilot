/**
 * Who runs this installation (NEXT_PHASES S2), as root entered it in the
 * configuration. The legal pages read this; nothing about the operator is
 * written in code.
 */
import { ensureSettings, settingString } from './settings';

export interface OperatorDetails {
  productName: string;
  appUrl: string;
  name: string;
  country: string;
  address: string;
  email: string;
  governingLaw: string;
  dataProtection: string;
  hosting: string;
  legalUpdated: string;
}

export async function operatorDetails(): Promise<OperatorDetails> {
  await ensureSettings();
  const read = (key: string) => settingString(key).trim();
  return {
    productName: read('operator.productName') || 'MS Social Pilot',
    appUrl: read('app.url'),
    name: read('operator.name'),
    country: read('operator.country'),
    address: read('operator.address'),
    email: read('operator.email'),
    governingLaw: read('operator.governingLaw'),
    dataProtection: read('operator.dataProtection'),
    hosting: read('operator.hosting'),
    legalUpdated: read('operator.legalUpdated'),
  };
}

/** The details the legal pages still lack, for root's status screen. */
export function missingOperatorDetails(details: OperatorDetails): Array<'name' | 'email' | 'governingLaw'> {
  return (['name', 'email', 'governingLaw'] as const).filter((key) => !details[key]);
}
