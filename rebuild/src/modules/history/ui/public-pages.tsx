import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { deletionRequestStatus } from '@/server/platforms/deletion-status';
import { fillText, parseBlocks, parseInline, resolveDataDeletionResults, resolveLegalValues, siteLocale, type SiteLocale, type SitePageContent } from '../public/content';
import { listPublicPlans, loadOperator, loadPublicChangelog, loadPublicHealth, loadSiteContent, siteIsPublic } from '../server/site';
import { runtimeConfig } from '@/server/config/store';
import styles from './public.module.css';

type Page = 'help' | 'pricing' | 'privacy' | 'terms' | 'status' | 'changelog' | 'dataDeletion';
const PATHS: Record<Page, string> = { help: '/help', pricing: '/pricing', privacy: '/privacy-policy', terms: '/terms', status: '/status', changelog: '/changelog', dataDeletion: '/data-deletion' };
/** Help, pricing, status and changelog follow the Root "public site" switch; the legal pages are always reachable because Meta links to them. */
const GATED: readonly Page[] = ['help', 'pricing', 'status', 'changelog'];

async function context(page: Page) {
  const locale = siteLocale((await headers()).get('accept-language'));
  if (GATED.includes(page) && !(await siteIsPublic())) notFound();
  const [content, { operator, appUrl }] = await Promise.all([loadSiteContent(locale), loadOperator()]);
  return { locale, content, operator, appUrl };
}

export async function pageMetadata(page: Page): Promise<Metadata> {
  const locale = siteLocale((await headers()).get('accept-language'));
  const content = await loadSiteContent(locale);
  const title = page === 'privacy' || page === 'terms' || page === 'dataDeletion' ? content[page].title : page === 'help' ? content.help.title : page === 'pricing' ? content.pricing.title : page === 'status' ? content.status.title : content.changelog.title;
  // The deletion lookup carries a confirmation code in its address: never index it or send it as a referrer.
  return { title, robots: { index: page !== 'dataDeletion', follow: page !== 'dataDeletion' }, ...(page === 'dataDeletion' ? { referrer: 'no-referrer' as const } : {}) };
}

function Inline({ text }: { text: string }) {
  return <>{parseInline(text).map((part, index) => part.kind === 'link' ? <a key={index} href={part.href}>{part.label}</a> : part.text)}</>;
}

/** Root-written text: paragraphs, "- " lists and safe links only. Nothing is ever interpreted as markup. */
export function RichBody({ body }: { body: string }) {
  return <>{parseBlocks(body).map((block, index) => block.kind === 'ul'
    ? <ul key={index}>{block.items.map((item, i) => <li key={i}><Inline text={item} /></li>)}</ul>
    : <p key={index}><Inline text={block.text} /></p>)}</>;
}

function SiteFrame({ content, operator, locale, current, children }: { content: SitePageContent; operator: { productName: string }; locale: SiteLocale; current: Page | null; children: ReactNode }) {
  const nav = content.nav;
  const link = (page: Page, label: string) => <a key={page} href={PATHS[page]} aria-current={current === page ? 'page' : undefined}>{label}</a>;
  return <div className={styles.shell} lang={locale}>
    <header className={styles.header}><div className={styles.bar}>
      <a className={styles.brand} href="/"><span className={styles.mark} aria-hidden="true">{Array.from(operator.productName)[0] ?? 'S'}</span>{operator.productName}</a>
      <nav className={styles.nav} aria-label={nav.label}>
        {link('help', nav.help)}{link('pricing', nav.pricing)}{link('changelog', nav.changelog)}{link('status', nav.status)}
        <a href="/sign-in">{nav.signIn}</a>
        <a className={styles.cta} href="/sign-up">{nav.signUp}</a>
      </nav>
    </div></header>
    <main className={styles.main}>{children}</main>
    <footer className={styles.footer}><div className={styles.footerBar}>
      <span>{operator.productName}</span>
      <nav aria-label={nav.label}>{link('privacy', nav.privacy)}{link('terms', nav.terms)}{link('dataDeletion', nav.dataDeletion)}</nav>
    </div></footer>
  </div>;
}

const Intro = ({ title, lead }: { title: string; lead?: string }) => <header className={styles.intro}><h1>{title}</h1>{lead && <p>{lead}</p>}</header>;

export async function HelpPage() {
  const { locale, content, operator } = await context('help');
  return <SiteFrame content={content} operator={operator} locale={locale} current="help">
    <Intro title={content.help.title} lead={content.help.lead} />
    <div className={styles.faq}>{content.help.items.map((item, index) => <details key={index}><summary>{item.question}</summary><div className={`${styles.answer} ${styles.prose}`}><RichBody body={item.answer} /></div></details>)}</div>
  </SiteFrame>;
}

export async function PricingPage() {
  const { locale, content, operator } = await context('pricing');
  const t = content.pricing;
  const plans = await listPublicPlans().catch(() => []);
  const money = (cents: number, currency: string) => new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
  const limit = (value: number | null, one: string, unlimited: string) => value === null ? unlimited : fillText(one, { count: new Intl.NumberFormat(locale).format(value) });
  return <SiteFrame content={content} operator={operator} locale={locale} current="pricing">
    <Intro title={t.title} lead={t.lead} />
    {plans.length === 0 ? <p className={styles.empty}>{t.none}</p> : <ul className={styles.plans}>{plans.map(plan => <li key={plan.key} className={styles.plan}>
      <h2>{plan.name}</h2>
      <p className={styles.price}>{plan.priceMonthly === 0 ? t.free : fillText(t.perMonth, { price: money(plan.priceMonthly, plan.currency) })}</p>
      {plan.priceYearly > 0 && <p className={styles.yearly}>{fillText(t.perYear, { price: money(plan.priceYearly, plan.currency) })}</p>}
      <ul className={styles.limits}>
        <li>{limit(plan.channels, t.channels, t.channelsUnlimited)}</li>
        <li>{limit(plan.members, t.members, t.membersUnlimited)}</li>
        <li>{limit(plan.postsPerMonth, t.posts, t.postsUnlimited)}</li>
        {plan.extraChannelPrice > 0 && <li>{fillText(t.extraChannel, { price: money(plan.extraChannelPrice, plan.currency) })}</li>}
        {plan.features.filter(feature => t.featureLabels[feature]).map(feature => <li key={feature}>{t.featureLabels[feature]}</li>)}
      </ul>
      <a className={styles.button} href="/sign-up">{t.choose}</a>
    </li>)}</ul>}
  </SiteFrame>;
}

export async function StatusPage() {
  const { locale, content, operator } = await context('status');
  const t = content.status;
  const health = await loadPublicHealth();
  const rows = [{ key: 'app', label: t.app, up: health.database }, { key: 'scheduler', label: t.scheduler, up: health.worker.status === 'ok' }];
  const allUp = rows.every(row => row.up);
  const checked = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date()) + ' UTC';
  return <SiteFrame content={content} operator={operator} locale={locale} current="status">
    <Intro title={t.title} lead={t.lead} />
    <p className={styles.statusPanel} role="status" data-ok={allUp}><span className={styles.dot} aria-hidden="true" />{allUp ? t.allUp : t.degraded}</p>
    <ul className={styles.rows}>{rows.map(row => <li key={row.key}><span>{row.label}</span><strong>{row.up ? t.up : t.down}</strong></li>)}</ul>
    <p className={styles.updated}>{fillText(t.checked, { time: checked })}</p>
  </SiteFrame>;
}

export async function ChangelogPage() {
  const { locale, content, operator } = await context('changelog');
  const t = content.changelog;
  const entries = await loadPublicChangelog();
  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
  return <SiteFrame content={content} operator={operator} locale={locale} current="changelog">
    <Intro title={t.title} lead={t.lead} />
    {entries.length === 0 ? <p className={styles.empty}>{t.empty}</p> : <ol className={styles.timeline}>{entries.map(entry => <li key={entry.id}>
      <time dateTime={entry.publishedOn}>{date(entry.publishedOn)}</time><h2>{entry.title}</h2>{entry.body && <p>{entry.body}</p>}
    </li>)}</ol>}
  </SiteFrame>;
}

async function Legal({ page }: { page: 'privacy' | 'terms' }) {
  const { locale, content, operator, appUrl } = await context(page);
  const t = content[page];
  const values = resolveLegalValues(operator, appUrl, content.fallbacks);
  return <SiteFrame content={content} operator={operator} locale={locale} current={page}>
    <Intro title={t.title} />
    <p className={styles.updated}>{operator.legalUpdated ? fillText(t.updated, { date: operator.legalUpdated }) : t.notUpdated}</p>
    <article className={styles.prose}>{t.sections.map((section, index) => <section key={index}><h2>{fillText(section.title, values)}</h2><RichBody body={fillText(section.body, values)} /></section>)}</article>
  </SiteFrame>;
}
export const PrivacyPage = () => <Legal page="privacy" />;
export const TermsPage = () => <Legal page="terms" />;

/** Instructions plus the outcome lookup for a provider data-deletion confirmation code (`?code=`). */
export async function DataDeletionPage({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  const { locale, content, operator, appUrl } = await context('dataDeletion');
  const t = content.dataDeletion;
  const values = resolveLegalValues(operator, appUrl, content.fallbacks);
  const raw = (await searchParams).code;
  const code = Array.isArray(raw) ? raw[0] : raw;
  const maxCode = Number(await runtimeConfig('public.dataDeletionCodeMaxCharacters').catch(() => 100));
  const status = code ? await deletionRequestStatus(code.slice(0, maxCode)) : null;
  const when = status?.state === 'completed' ? new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(status.completedAt) : '';
  const results = resolveDataDeletionResults(t, locale);
  const result = !status ? null
    : status.state === 'completed' ? fillText(status.connections === 1 ? results.resultCompletedOne : results.resultCompletedMany, { count: status.connections, when })
    : status.state === 'unknown' ? results.resultUnknown : results.resultInvalid;
  return <SiteFrame content={content} operator={operator} locale={locale} current="dataDeletion">
    <Intro title={t.title} lead={t.lead} />
    {result && <p className={styles.statusPanel} role="status" data-ok={status?.state === 'completed'}><span className={styles.dot} aria-hidden="true" />{result}</p>}
    <article className={styles.prose}>{t.sections.map((section, index) => <section key={index}><h2>{fillText(section.title, values)}</h2><RichBody body={fillText(section.body, values)} /></section>)}</article>
    <form className={styles.lookup} method="get" action="/data-deletion">
      <label>{t.lookupLabel}<input name="code" defaultValue={code ?? ''} maxLength={maxCode} autoComplete="off" spellCheck={false} /></label>
      <button className={styles.button} type="submit">{t.lookupButton}</button>
    </form>
  </SiteFrame>;
}
