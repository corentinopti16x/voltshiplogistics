import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { CreateClientForm } from "@/components/admin/create-client-form";

export default async function NewClientPage() {
  const t = await getTranslations("admin");

  return (
    <div>
      <Link
        href="/admin/clients"
        className="text-sm text-[var(--muted)] hover:text-[var(--ink)]"
      >
        ← {t("back")}
      </Link>
      <h1 className="font-display mt-4 text-3xl">{t("newClient")}</h1>
      <p className="mt-2 mb-8 text-sm text-[var(--muted)]">{t("newLead")}</p>
      <CreateClientForm />
    </div>
  );
}
