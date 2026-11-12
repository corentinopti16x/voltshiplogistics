"use client";

import { useActionState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import {
  createProductForClientAction,
  type SourcingActionResult,
} from "@/app/actions/sourcing";

const initial: SourcingActionResult = { ok: false };
const MARKETS = ["FR", "US", "DE", "IT", "BE", "ES", "CH", "CA", "GB"];

/** Team form: a client asked for a product by message, the team opens the request for them. */
export function TeamNewProductForm({
  clients,
}: {
  clients: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations("sourcer.newProduct");
  const router = useRouter();
  const [state, action, pending] = useActionState(createProductForClientAction, initial);

  useEffect(() => {
    if (state.ok && state.nextId) router.replace(`/sourcer/${state.nextId}`);
  }, [state, router]);

  const label = "text-[12px] font-semibold text-[var(--muted)]";
  return (
    <form action={action} encType="multipart/form-data" className="flex max-w-xl flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className={label}>{t("client")}</span>
        <select name="client_id" required defaultValue="" className="vs-input">
          <option value="" disabled>
            {t("clientPick")}
          </option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className={label}>{t("name")}</span>
        <input name="title" required minLength={2} className="vs-input" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className={label}>{t("photo")}</span>
        <input name="photo" type="file" accept="image/*" className="vs-input" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className={label}>{t("link")}</span>
        <input name="source_url" type="url" placeholder="https://" className="vs-input" />
        <span className="text-[12px] text-[var(--muted)]">{t("photoOrLink")}</span>
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className={label}>{t("markets")}</span>
        <input
          name="destinations"
          required
          list="team-new-product-markets"
          placeholder="FR, US"
          className="vs-input"
        />
        <datalist id="team-new-product-markets">
          {MARKETS.map((market) => (
            <option key={market} value={market} />
          ))}
        </datalist>
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className={label}>{t("notes")}</span>
        <textarea name="notes" rows={3} className="vs-input" placeholder={t("notesHint")} />
      </label>
      {state.error ? (
        <p className="text-sm text-[var(--rust-ink)]" role="alert">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex cursor-pointer items-center justify-center self-start rounded-[10px] bg-[var(--navy)] px-4 py-2.5 text-[14px] font-semibold text-white transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? t("creating") : t("create")}
      </button>
    </form>
  );
}
