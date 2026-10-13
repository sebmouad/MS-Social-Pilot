import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { ConfigClient } from "@/components/ConfigClient";
import Link from "next/link";

import { aiSpend } from "@/lib/ai";
import { requireRoot } from "@/lib/auth";
import { screenMetadata } from "@/lib/metadata";
import { configSection, isConfigSection } from "@/lib/root-config-sections";
import { settingSection } from "@/lib/root-platforms";
import { GROUP_LABELS, GROUP_ORDER, describeSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  return screenMetadata(
    isConfigSection(section)
      ? `config.sections.${section}.title`
      : "config.title",
  );
}

/**
 * One screen of the app's own settings (site address, AI, storage, email,
 * security, general). Platform settings live in the Platforms sections. Root
 * only, and not scoped to a workspace — these settings are the whole
 * installation's.
 */
export default async function RootConfigSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  await requireRoot();
  const { section } = await params;
  if (!isConfigSection(section)) notFound();
  const t = await getTranslations("config");
  const [all, spend] = await Promise.all([
    describeSettings(),
    section === "ai" ? aiSpend() : undefined,
  ]);
  const settings = all.filter(
    (entry) =>
      settingSection(entry.key, entry.group) === null &&
      configSection(entry.key, entry.group) === section,
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">
          {t(`sections.${section}.title`)}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {t(`sections.${section}.subtitle`)}
        </p>
      </header>

      {section === "general" && (
        <p className="card p-4 text-sm text-slate-600">
          {t("platformsMoved")}{" "}
          <Link
            href="/root/platforms"
            className="font-semibold text-brand-600 hover:underline"
          >
            {t("platformsLink")}
          </Link>
        </p>
      )}

      <ConfigClient
        hideGroupHeading={section}
        hideSingleGroupHeading
        key={section}
        settings={settings}
        groupLabels={GROUP_LABELS}
        groupOrder={GROUP_ORDER}
        aiSpend={spend}
      />

      <p className="text-xs text-slate-500">{t("footnote")}</p>
    </div>
  );
}
