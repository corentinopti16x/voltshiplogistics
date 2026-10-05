import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { AppPreview } from "@/components/landing/app-preview";
import { QuotePreview } from "@/components/landing/quote-preview";
import { FeatureGrid } from "@/components/landing/feature-grid";
import { WorkflowTimeline } from "@/components/landing/workflow-timeline";
import { SiteHeader } from "@/components/site-header";
import { BrandMark } from "@/components/brand-mark";
import { getSessionUser } from "@/lib/supabase/session";

const statusKeys = ["winning", "testing", "declining", "dead"] as const;
const statusDot = {
  winning: "bg-[#c4a35a]",
  testing: "bg-[#6f93b8]",
  declining: "bg-[#c4844a]",
  dead: "bg-[#9a958a]",
};

const featureKeys = [
  "library",
  "quote",
  "stock",
  "research",
  "economics",
  "notifications",
] as const;

const workflowStepKeys = [
  "brief",
  "source",
  "accept",
  "produce",
  "sell",
] as const;

export default async function LandingPage() {
  const t = await getTranslations("landing");
  const user = await getSessionUser();
  const signedIn = Boolean(user);
  const href = signedIn ? "/home" : "/login";

  const products = [
    {
      name: t("products.bottle"),
      image:
        "https://images.unsplash.com/photo-1602143407151-01114712e5d0?auto=format&fit=crop&w=600&q=80",
      status: "winning" as const,
      statusLabel: t("statuses.winning"),
      sales: "8.4",
      days: "18",
      roas: "2.4",
    },
    {
      name: t("products.ceramic"),
      image:
        "https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?auto=format&fit=crop&w=600&q=80",
      status: "testing" as const,
      statusLabel: t("statuses.testing"),
      sales: "1.2",
      days: "41",
    },
    {
      name: t("products.lamp"),
      image:
        "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=600&q=80",
      status: "declining" as const,
      statusLabel: t("statuses.declining"),
      sales: "0.6",
      days: "74",
    },
    {
      name: t("products.serum"),
      image:
        "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=600&q=80",
      status: "dead" as const,
      statusLabel: t("statuses.dead"),
      sales: "0",
      days: "—",
    },
  ];

  const features = featureKeys.map((key) => ({
    key,
    title: t(`features.${key}.title`),
    body: t(`features.${key}.body`),
  }));

  const workflowSteps = workflowStepKeys.map((key) => ({
    num: t(`workflow.steps.${key}.num`),
    title: t(`workflow.steps.${key}.title`),
    body: t(`workflow.steps.${key}.body`),
  }));

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      {/* ── Hero ── */}
      <div className="landing-hero relative overflow-hidden">
        <div className="landing-grain absolute inset-0" />

        {/* Ambient glow orbs */}
        <div
          className="animate-glow-pulse pointer-events-none absolute -top-32 right-1/4 h-[500px] w-[500px] rounded-full bg-[radial-gradient(circle,rgba(196,163,90,0.12),transparent_70%)]"
          aria-hidden
        />
        <div
          className="animate-glow-pulse pointer-events-none absolute -bottom-40 -left-20 h-[400px] w-[400px] rounded-full bg-[radial-gradient(circle,rgba(62,110,82,0.15),transparent_70%)]"
          style={{ animationDelay: "2s" }}
          aria-hidden
        />

        <SiteHeader signedIn={signedIn} tone="dark" />

        <section className="relative mx-auto grid max-w-6xl items-center gap-14 px-6 pt-16 pb-24 lg:grid-cols-[1.05fr_0.95fr] lg:pt-24 lg:pb-32">
          <div>
            <p className="animate-fade-in-up text-[11px] font-semibold tracking-[0.22em] text-[#c4a35a] uppercase">
              {t("kicker")}
            </p>
            <h1 className="font-display animate-fade-in-up delay-100 mt-5 max-w-xl text-5xl leading-[1.02] tracking-tight text-[#f6f1e7] whitespace-pre-line sm:text-7xl">
              {t("headline")}
            </h1>
            <p className="animate-fade-in-up delay-200 mt-6 max-w-md text-[17px] leading-relaxed text-[#d5cfc2]">
              {t("sub")}
            </p>
            <div className="animate-fade-in-up delay-300 mt-9 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <Link
                href={href}
                className="cta-button rounded-full bg-[#f3eee4] px-7 py-3.5 text-sm font-semibold text-[#132018] hover:bg-white"
              >
                {signedIn ? t("ctaSignedIn") : t("cta")}
              </Link>
              <p className="text-xs text-[#b7b0a2]">{t("invite")}</p>
            </div>
          </div>

          <div className="animate-fade-in delay-400">
            <AppPreview
              title={t("previewTitle")}
              filterAll={t("filterAll")}
              salesDay={t("salesDay")}
              daysLeft={t("daysLeft")}
              products={products}
            />
          </div>
        </section>

        {/* Status legend strip */}
        <div className="relative border-t border-white/10">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-[#b7b0a2]">{t("statuses.title")}</p>
            <ul className="flex flex-wrap gap-5 text-sm text-[#f6f1e7]">
              {statusKeys.map((key) => (
                <li key={key} className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${statusDot[key]}`}
                  />
                  {t(`statuses.${key}`)}
                </li>
              ))}
            </ul>
          </div>
        </div>

      </div>

      {/* ── Features ── */}
      <section className="mx-auto max-w-6xl px-6 py-20 lg:py-28">
        <div className="mb-12 max-w-2xl">
          <h2 className="font-display text-4xl tracking-tight sm:text-5xl">
            {t("featuresTitle")}
          </h2>
          <p className="mt-4 text-[17px] leading-relaxed text-[var(--muted)]">
            {t("featuresSub")}
          </p>
        </div>
        <FeatureGrid features={features} />
      </section>

      <div className="section-divider mx-6" />

      {/* ── Quote section ── */}
      <section className="bg-[var(--card)]">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-20 lg:grid-cols-2 lg:py-28">
          <div>
            <h2 className="font-display text-4xl tracking-tight sm:text-5xl">
              {t("quote.sectionTitle")}
            </h2>
            <p className="mt-4 max-w-md text-[17px] leading-relaxed text-[var(--muted)]">
              {t("quote.sectionBody")}
            </p>

            {/* Benefits */}
            <div className="mt-10 space-y-6">
              {(["benefit1", "benefit2", "benefit3"] as const).map((key) => (
                <div key={key} className="flex gap-4">
                  <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--card)]">
                    <svg
                      width="14"
                      height="14"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-[15px] font-semibold">
                      {t(`quote.${key}Title`)}
                    </p>
                    <p className="mt-0.5 text-sm text-[var(--muted)]">
                      {t(`quote.${key}Body`)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="animate-float">
            <QuotePreview
              kicker={t("quote.kicker")}
              productName={t("products.bottle")}
              productLabel={t("quote.product")}
              productPrice="4,20 €"
              shippingLabel={t("quote.shipping")}
              shippingPrice="3,90 €"
              handlingLabel={t("quote.handling")}
              handlingPrice="1,70 €"
              totalLabel={t("quote.total")}
              totalPrice="9,80 €"
              badge={t("quote.badge")}
              carrier="YunExpress · FR"
            />
          </div>
        </div>
      </section>

      <div className="section-divider mx-6" />

      {/* ── Workflow timeline ── */}
      <section className="mx-auto max-w-6xl px-6 py-20 lg:py-28">
        <div className="mb-14 max-w-2xl">
          <h2 className="font-display text-4xl tracking-tight sm:text-5xl">
            {t("workflow.title")}
          </h2>
          <p className="mt-4 text-[17px] leading-relaxed text-[var(--muted)]">
            {t("workflow.sub")}
          </p>
        </div>
        <WorkflowTimeline steps={workflowSteps} />
      </section>

      {/* ── Closing CTA ── */}
      <section className="landing-hero relative overflow-hidden">
        <div className="landing-grain absolute inset-0" />
        <div
          className="animate-glow-pulse pointer-events-none absolute top-1/2 left-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(196,163,90,0.1),transparent_65%)]"
          aria-hidden
        />
        <div className="relative mx-auto max-w-6xl px-6 py-28 text-center lg:py-36">
          <h2 className="font-display gradient-text mx-auto max-w-xl text-4xl leading-tight whitespace-pre-line sm:text-5xl">
            {t("close.title")}
          </h2>
          <p className="mx-auto mt-5 max-w-md text-[#d5cfc2]">
            {t("close.body")}
          </p>
          <Link
            href={href}
            className="cta-button mt-10 inline-flex rounded-full bg-[#f3eee4] px-8 py-4 text-sm font-semibold text-[#132018] hover:bg-white"
          >
            {signedIn ? t("ctaSignedIn") : t("cta")}
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-[var(--line)] bg-[var(--bg)]">
        <div className="mx-auto max-w-6xl px-6 py-12 lg:py-16">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            {/* Brand */}
            <div className="lg:col-span-2">
              <BrandMark />
              <p className="mt-3 max-w-xs text-sm leading-relaxed text-[var(--muted)]">
                {t("close.body")}
              </p>
            </div>

            {/* Product links */}
            <div>
              <p className="text-xs font-semibold tracking-[0.15em] text-[var(--muted)] uppercase">
                {t("footer.product")}
              </p>
              <ul className="mt-4 space-y-2.5 text-sm text-[var(--ink)]">
                {(
                  ["library", "quotes", "stock", "research"] as const
                ).map((key) => (
                  <li key={key}>
                    <span className="cursor-default transition-colors hover:text-[var(--gold)]">
                      {t(`footer.productLinks.${key}`)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Company links */}
            <div>
              <p className="text-xs font-semibold tracking-[0.15em] text-[var(--muted)] uppercase">
                {t("footer.company")}
              </p>
              <ul className="mt-4 space-y-2.5 text-sm text-[var(--ink)]">
                {(["about", "contact"] as const).map((key) => (
                  <li key={key}>
                    <span className="cursor-default transition-colors hover:text-[var(--gold)]">
                      {t(`footer.companyLinks.${key}`)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-[var(--line)] pt-8 text-xs text-[var(--muted)] sm:flex-row">
            <span>{t("footer.copy")}</span>
            <div className="flex items-center gap-4">
              <Link href="/staff/login" className="hover:text-[var(--ink)]">
                {t("footer.staff")}
              </Link>
              <span>FR · EN</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
