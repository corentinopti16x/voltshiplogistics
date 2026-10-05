import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { NewProductForm } from "@/components/client/new-product-form";
import { Card, PageTitle, SectionTitle } from "@/components/ui";

export default async function NewProductPage() {
  const t = await getTranslations("products");
  const steps = ["drop", "visit", "validate"] as const;

  return (
    <div className="flex flex-col gap-5">
      <PageTitle
        bandClass="h-[250px]"
        kicker={
          <Link href="/products" className="hover:underline">
            ← {t("back")}
          </Link>
        }
        title={t("new")}
        lead={t("newLead")}
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <Card as="section" padding="lg">
          <NewProductForm />
        </Card>
        <Card as="section" padding="md">
          <SectionTitle>{t("howItWorks.title")}</SectionTitle>
          <ol className="mt-4 flex flex-col">
            {steps.map((step, index) => (
              <li key={step} className="flex gap-3.5">
                <div className="flex flex-col items-center">
                  <span
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-[10px] text-[14px] font-extrabold ${
                      index === 0
                        ? "bg-[var(--gold-bright)] text-[var(--navy)]"
                        : "bg-[var(--line-soft)] text-[var(--navy)]"
                    }`}
                  >
                    {index + 1}
                  </span>
                  {index < steps.length - 1 ? (
                    <span aria-hidden className="h-7 w-0.5 bg-[var(--line)]" />
                  ) : null}
                </div>
                <div className="pt-1.5 pb-3">
                  <p className="text-[14px] font-bold">{t(`howItWorks.${step}.title`)}</p>
                  <p className="text-[13px] text-[var(--muted)]">{t(`howItWorks.${step}.body`)}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}
