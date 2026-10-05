import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Client } from "@/lib/auth/types";

export default async function AdminClientsPage() {
  const t = await getTranslations("admin");
  const admin = createAdminClient();

  const [{ data: clients }, { data: profiles }] = await Promise.all([
    admin
      .from("clients")
      .select("id, name, code, language, plan_tier, timezone, created_at")
      .order("created_at", { ascending: false })
      .returns<Client[]>(),
    admin.from("profiles").select("client_id").not("client_id", "is", null),
  ]);

  const counts = new Map<string, number>();
  for (const row of profiles ?? []) {
    if (!row.client_id) continue;
    counts.set(row.client_id, (counts.get(row.client_id) ?? 0) + 1);
  }

  const rows = clients ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.2em] text-[var(--gold)] uppercase">
            {t("kicker")}
          </p>
          <h1 className="font-display mt-2 text-3xl">{t("title")}</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">{t("lead")}</p>
        </div>
        <Link
          href="/admin/clients/new"
          className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
        >
          {t("newClient")}
        </Link>
      </div>

      {rows.length === 0 ? (
        <section className="mt-8 rounded-2xl border border-dashed border-[var(--line)] bg-[var(--card)] p-8 text-sm text-[var(--muted)]">
          {t("empty")}
        </section>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--card)]">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="border-b border-[var(--line)] text-xs tracking-wide text-[var(--muted)] uppercase">
              <tr>
                <th className="px-4 py-3">{t("fields.name")}</th>
                <th className="px-4 py-3">{t("fields.code")}</th>
                <th className="px-4 py-3">{t("fields.plan")}</th>
                <th className="px-4 py-3">{t("fields.language")}</th>
                <th className="px-4 py-3">{t("fields.users")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((client) => (
                <tr key={client.id} className="border-t border-[var(--line)]">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/clients/${client.id}`}
                      className="font-medium hover:underline"
                    >
                      {client.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[var(--muted)]">{client.code ?? "—"}</td>
                  <td className="px-4 py-3 capitalize">{client.plan_tier}</td>
                  <td className="px-4 py-3 uppercase">{client.language}</td>
                  <td className="px-4 py-3">{counts.get(client.id) ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
