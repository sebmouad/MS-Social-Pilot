'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Dialog } from './Dialog';
import { Icon } from './Icon';

import { REPORT_SECTIONS, type ReportSection } from '@/lib/report-sections';

interface Branding {
  logoUrl: string;
  reportTitle: string;
  reportSubtitle: string;
  reportFooter: string;
}

/**
 * Make the report the client will read: which sections it has, and the
 * cover and footer it carries.
 *
 * The sections ride in the address (`sections`), so a report built once can
 * be bookmarked and printed again next month exactly the same. The branding
 * is the workspace's own, saved once by an admin and printed on every report.
 */
export function ReportBuilder({
  sections,
  branding,
  canBrand,
}: {
  sections: ReportSection[];
  branding: Branding;
  canBrand: boolean;
}) {
  const t = useTranslations('reports');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<ReportSection[]>(sections);
  const [brand, setBrand] = useState<Branding>(branding);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = useCallback(() => {
    setOpen(false);
    setError(null);
  }, []);

  async function apply() {
    setPending(true);
    setError(null);
    try {
      const changed = (Object.keys(brand) as Array<keyof Branding>).some((key) => brand[key] !== branding[key]);
      if (canBrand && changed) {
        const response = await fetch('/api/workspace', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(brand),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> };
          setError(Object.values(body.fields ?? {})[0] ?? body.error ?? tCommon('genericError'));
          return;
        }
      }
      const params = new URLSearchParams(search.toString());
      const all = REPORT_SECTIONS.every((section) => chosen.includes(section));
      if (all) params.delete('sections');
      else params.set('sections', chosen.join(','));
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      router.refresh();
      setOpen(false);
    } catch {
      setError(tCommon('genericError'));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button type="button" className="btn-primary print:hidden" onClick={() => setOpen(true)}>
        <Icon name="settings" size={16} />
        {t('customise')}
      </button>

      <Dialog
        open={open}
        title={t('customiseTitle')}
        onClose={close}
        closeLabel={tCommon('close')}
        wide
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={close}>
              {tCommon('cancel')}
            </button>
            <button type="button" className="btn-primary" disabled={pending || chosen.length === 0} onClick={() => void apply()}>
              {pending ? tCommon('working') : t('applyChanges')}
            </button>
          </>
        }
      >
        <div className="grid gap-6 sm:grid-cols-2">
          <fieldset>
            <legend className="text-sm font-semibold text-slate-900">{t('sectionsTitle')}</legend>
            <p className="mb-2 text-xs text-slate-500">{t('sectionsHint')}</p>
            <ul className="space-y-1">
              {REPORT_SECTIONS.map((section) => {
                const on = chosen.includes(section);
                return (
                  <li key={section}>
                    <label className={`flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 ${on ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
                        checked={on}
                        onChange={() =>
                          setChosen(on ? chosen.filter((value) => value !== section) : REPORT_SECTIONS.filter((value) => value === section || chosen.includes(value)))
                        }
                      />
                      <span>
                        <span className="block text-sm font-semibold text-slate-900">{t(`section_${section}`)}</span>
                        <span className="block text-xs text-slate-500">{t(`sectionHint_${section}`)}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>

          <fieldset disabled={!canBrand} className="space-y-3">
            <legend className="text-sm font-semibold text-slate-900">{t('brandingTitle')}</legend>
            <p className="text-xs text-slate-500">{canBrand ? t('brandingHint') : t('brandingAdminsOnly')}</p>
            {error && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
            <div>
              <label className="label" htmlFor="report-logo">
                {t('logoUrl')}
              </label>
              <div className="flex items-center gap-3">
                {brand.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={brand.logoUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-contain ring-1 ring-slate-200" />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                    <Icon name="image" size={18} />
                  </span>
                )}
                <input
                  id="report-logo"
                  className="input"
                  placeholder="https://…/logo.png"
                  value={brand.logoUrl}
                  onChange={(event) => setBrand({ ...brand, logoUrl: event.target.value })}
                />
              </div>
            </div>
            {(
              [
                ['reportTitle', t('coverTitleField'), t('coverTitlePlaceholder'), 120],
                ['reportSubtitle', t('coverSubtitleField'), t('coverSubtitlePlaceholder'), 200],
                ['reportFooter', t('footerField'), t('footerPlaceholder'), 300],
              ] as const
            ).map(([key, label, placeholder, max]) => (
              <div key={key}>
                <label className="label" htmlFor={`report-${key}`}>
                  {label}
                </label>
                <input
                  id={`report-${key}`}
                  className="input"
                  placeholder={placeholder}
                  maxLength={max}
                  value={brand[key]}
                  onChange={(event) => setBrand({ ...brand, [key]: event.target.value })}
                />
              </div>
            ))}
          </fieldset>
        </div>
      </Dialog>
    </>
  );
}
