import { getTranslations } from "next-intl/server";

export default async function InboundPage() {
  const t = await getTranslations("inbound");

  return (
    <div>
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">{t("lead")}</p>
      <p className="mt-8 rounded-2xl border border-dashed border-[var(--line)] bg-[var(--card)] p-8 text-sm text-[var(--muted)]">
        {t("empty")}
      </p>
    </div>
  );
}
