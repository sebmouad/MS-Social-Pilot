'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Dialog } from './Dialog';
import { platformSettingsHref } from '@/lib/root-platforms';
import { Icon } from './Icon';

export interface SummaryRow {
  type: string;
  label: string;
  count: number;
  /** Where the connected ones are listed on this screen. */
  anchor: string;
  /** What connecting needs, in plain words. */
  hint: string;
  /** A full navigation to the network's sign-in, a form further down, or nothing this person can do. */
  action: { kind: 'link'; href: string } | { kind: 'needsApp' } | null;
}

/**
 * Every network at a glance, "Not connected" or "N connected", each opening a
 * sheet that says what connecting needs and starts it.
 */
export function ConnectSummary({ rows, isRoot }: { rows: SummaryRow[]; isRoot: boolean }) {
  const t = useTranslations('connections');
  const tNetworks = useTranslations('networks');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState<SummaryRow | null>(null);

  return (
    <>
      <section aria-label={t('summaryLabel')} className="card divide-y divide-slate-100">
        {rows.map((row) => (
          <button
            key={row.type}
            type="button"
            onClick={() => setOpen(row)}
            className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-slate-50"
          >
            <span className="font-semibold text-slate-900">{row.label}</span>
            <span className={row.count > 0 ? 'font-semibold text-emerald-700' : 'text-slate-500'}>
              {row.count > 0 ? t('summaryConnected', { count: row.count }) : t('summaryNone')}
            </span>
          </button>
        ))}
      </section>

      <Dialog
        open={open !== null}
        title={open ? t('sheetTitle', { network: open.label }) : ''}
        onClose={() => setOpen(null)}
        closeLabel={tCommon('close')}
        footer={
          open && (
            <div className="flex flex-wrap justify-end gap-2">
              {open.count > 0 && (
                <a href={open.anchor} className="btn-secondary" onClick={() => setOpen(null)}>
                  {t('sheetSeeConnected')}
                </a>
              )}
              {open.action?.kind === 'link' && (
                <a href={open.action.href} className="btn-primary">
                  <Icon name="plus" size={16} />
                  {open.count > 0 ? tNetworks('connectAnother') : tNetworks('connect', { network: open.label })}
                </a>
              )}
            </div>
          )
        }
      >
        {open && (
          <div className="space-y-3 text-sm text-slate-700">
            <p>{open.count > 0 ? t('summaryConnected', { count: open.count }) : t('summaryNone')}</p>
            <p>{open.hint}</p>
            {open.action === null && <p className="text-slate-500">{t('sheetNoRight')}</p>}
            {open.action?.kind === 'needsApp' && (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600">
                {isRoot ? (
                  <>
                    {tNetworks('needsApp', { network: open.label })}{' '}
                    <Link href={platformSettingsHref(open.type)} className="font-semibold text-brand-600 hover:underline">
                      {tNetworks('openConfig')}
                    </Link>
                  </>
                ) : (
                  tNetworks('needsAppAskOwner', { network: open.label })
                )}
              </p>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
