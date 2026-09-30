import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { NewProductForm } from "@/components/client/new-product-form";

export default async function NewProductPage() {
  const t = await getTranslations("products");

  return (
    <div>
      <Link href="/products" className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">
        ← {t("back")}
      </Link>
      <h1 className="font-display mt-4 text-3xl">{t("new")}</h1>
      <p className="mt-2 mb-8 text-sm text-[var(--muted)]">{t("newLead")}</p>
      <NewProductForm />
    </div>
  );
}
