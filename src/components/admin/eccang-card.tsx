"use client";

import { useActionState, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  pushEccangProductsAction,
  saveEccangSettingsAction,
  saveEccangShippingMapAction,
  syncEccangNowAction,
  testEccangConnectionAction,
  type EccangActionResult,
} from "@/app/actions/eccang";

const initial: EccangActionResult = { ok: false };

export type EccangCardProps = {
  clientId: string;
  configured: boolean;
  enabled: boolean;
  appKey: string;
  hasToken: boolean;
  warehouseCode: string;
  lastSyncAt: string | null;
  syncError: string | null;
  /** carrier / carrier|line keys found in the active rate grid (suggestions). */
  carrierKeys: string[];
  shippingMap: Record<string, string>;
  callbackUrl: string;
  stats: { products: number; pushedProducts: number; orders: number; inbound: number };
};

const inputClass =
  "rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm disabled:opacity-60";
const buttonClass =
  "cursor-pointer rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60";
const secondaryClass =
  "cursor-pointer rounded-md border border-[var(--line)] bg-white px-4 py-2 text-sm font-medium disabled:opacity-60";

function Feedback({ state }: { state: EccangActionResult }) {
  const t = useTranslations("admin.eccangCard");
  if (state.error) return <p className="text-sm text-red-700">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-emerald-800">{state.summary ?? t("saved")}</p>;
  return null;
}

export function EccangCard(props: EccangCardProps) {
  const t = useTranslations("admin.eccangCard");
  const locale = useLocale();
  const [settings, saveSettings, saving] = useActionState(saveEccangSettingsAction, initial);
  const [test, runTest, testing] = useActionState(testEccangConnectionAction, initial);
  const [sync, runSync, syncing] = useActionState(syncEccangNowAction, initial);
  const [push, runPush, pushing] = useActionState(pushEccangProductsAction, initial);
  const [mapState, saveMap, savingMap] = useActionState(saveEccangShippingMapAction, initial);
  const [rows, setRows] = useState<Array<{ key: string; code: string }>>(() => {
    const entries = Object.entries(props.shippingMap).map(([key, code]) => ({ key, code }));
    return entries.length ? entries : [{ key: "", code: "" }];
  });

  const warehouses = test.warehouses ?? [];
  const methods = test.shippingMethods ?? [];
  const canCall = props.configured && props.appKey && props.hasToken;

  return (
    <section id="eccang" className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{t("title")}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{t("lead")}</p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            props.enabled ? "bg-emerald-100 text-emerald-900" : "bg-[var(--bg)] text-[var(--muted)]"
          }`}
        >
          {props.enabled ? t("enabled") : t("disabled")}
        </span>
      </div>

      {!props.configured ? (
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t.rich("notConfigured", { code: (chunks) => <code>{chunks}</code> })}
        </p>
      ) : null}

      {/* Settings */}
      <form action={saveSettings} className="mt-5 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="client_id" value={props.clientId} />
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="eccang_enabled" defaultChecked={props.enabled} />
          {t("enableLabel")}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--muted)]">appKey</span>
          <input name="app_key" defaultValue={props.appKey} className={inputClass} autoComplete="off" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--muted)]">
            appToken {props.hasToken ? t("tokenSaved") : ""}
          </span>
          <input
            name="app_token"
            type="password"
            placeholder={props.hasToken ? "••••••••••••" : ""}
            className={inputClass}
            autoComplete="new-password"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--muted)]">{t("warehouseCode")}</span>
          {warehouses.length > 0 ? (
            <select name="warehouse_code" defaultValue={props.warehouseCode} className={inputClass}>
              <option value="">—</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.warehouse_code} value={warehouse.warehouse_code}>
                  {warehouse.warehouse_code} · {warehouse.warehouse_name}
                  {warehouse.country_code ? ` (${warehouse.country_code})` : ""}
                </option>
              ))}
            </select>
          ) : (
            <input
              name="warehouse_code"
              defaultValue={props.warehouseCode}
              placeholder={t("warehousePlaceholder")}
              className={inputClass}
            />
          )}
        </label>
        <div className="flex items-end gap-3">
          <button type="submit" disabled={saving} className={buttonClass}>
            {saving ? t("saving") : t("save")}
          </button>
          <Feedback state={settings} />
        </div>
      </form>

      {/* Test + sync + push */}
      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-5">
        <form action={runTest}>
          <input type="hidden" name="client_id" value={props.clientId} />
          <button type="submit" disabled={testing || !canCall} className={secondaryClass}>
            {testing ? t("testing") : t("test")}
          </button>
        </form>
        <form action={runSync}>
          <input type="hidden" name="client_id" value={props.clientId} />
          <button type="submit" disabled={syncing || !canCall || !props.warehouseCode} className={secondaryClass}>
            {syncing ? t("syncing") : t("sync")}
          </button>
        </form>
        <form action={runPush}>
          <input type="hidden" name="client_id" value={props.clientId} />
          <button type="submit" disabled={pushing || !canCall || !props.warehouseCode} className={secondaryClass}>
            {pushing ? t("pushing") : t("push")}
          </button>
        </form>
      </div>
      <div className="mt-2 space-y-1">
        <Feedback state={test} />
        <Feedback state={sync} />
        <Feedback state={push} />
      </div>

      {warehouses.length > 0 ? (
        <div className="mt-3 rounded-md bg-[var(--bg)] p-3 text-xs">
          <p className="font-semibold">{t("warehouses")}</p>
          <ul className="mt-1 space-y-0.5">
            {warehouses.map((warehouse) => (
              <li key={warehouse.warehouse_code}>
                <code>{warehouse.warehouse_code}</code> — {warehouse.warehouse_name}
                {warehouse.country_code ? ` (${warehouse.country_code})` : ""}
              </li>
            ))}
          </ul>
          {methods.length > 0 ? (
            <>
              <p className="mt-3 font-semibold">{t("shippingMethods")}</p>
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-auto">
                {methods.map((method) => (
                  <li key={`${method.warehouse_code ?? ""}:${method.code}`}>
                    <code>{method.code}</code> — {method.name_en ?? method.name ?? ""}
                    {method.warehouse_code ? ` · ${method.warehouse_code}` : ""}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}

      {/* Status */}
      <dl className="mt-5 grid gap-3 border-t border-[var(--line)] pt-5 text-sm sm:grid-cols-4">
        <Row
          label={t("lastSync")}
          value={props.lastSyncAt ? new Date(props.lastSyncAt).toLocaleString(locale) : t("never")}
        />
        <Row label={t("pushedProducts")} value={`${props.stats.pushedProducts} / ${props.stats.products}`} />
        <Row label={t("orders")} value={String(props.stats.orders)} />
        <Row label={t("inbound")} value={String(props.stats.inbound)} />
      </dl>
      {props.syncError ? (
        <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {t("syncError", { error: props.syncError })}
        </p>
      ) : null}

      {/* Shipping method mapping (global) */}
      <form action={saveMap} className="mt-6 border-t border-[var(--line)] pt-5">
        <input type="hidden" name="client_id" value={props.clientId} />
        <h3 className="text-sm font-semibold">{t("mapTitle")}</h3>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {t.rich("mapHelp", { code: (chunks) => <code>{chunks}</code> })}
        </p>
        <datalist id="eccang-carrier-keys">
          {props.carrierKeys.map((key) => (
            <option key={key} value={key} />
          ))}
          <option value="default" />
        </datalist>
        <datalist id="eccang-method-codes">
          {methods.map((method) => (
            <option key={method.code} value={method.code}>
              {method.name_en ?? method.name ?? ""}
            </option>
          ))}
        </datalist>
        <div className="mt-3 space-y-2">
          {rows.map((row, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <input
                name="map_key"
                list="eccang-carrier-keys"
                value={row.key}
                placeholder="YunExpress|CHC"
                onChange={(event) =>
                  setRows((prev) => prev.map((r, i) => (i === index ? { ...r, key: event.target.value } : r)))
                }
                className={inputClass}
              />
              <input
                name="map_code"
                list="eccang-method-codes"
                value={row.code}
                placeholder={t("codePlaceholder")}
                onChange={(event) =>
                  setRows((prev) => prev.map((r, i) => (i === index ? { ...r, code: event.target.value } : r)))
                }
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev))}
                className={secondaryClass}
                aria-label={t("removeRow")}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, { key: "", code: "" }])}
            className={secondaryClass}
          >
            {t("addRow")}
          </button>
          <button type="submit" disabled={savingMap} className={buttonClass}>
            {savingMap ? t("saving") : t("saveMap")}
          </button>
          <Feedback state={mapState} />
        </div>
      </form>

      <div className="mt-6 border-t border-[var(--line)] pt-5 text-xs text-[var(--muted)]">
        <p className="font-semibold text-[var(--ink)]">{t("callbackTitle")}</p>
        <code className="mt-1 block break-all rounded-md bg-[var(--bg)] px-3 py-2">{props.callbackUrl}</code>
        <p className="mt-1">{t.rich("callbackHelp", { code: (chunks) => <code>{chunks}</code> })}</p>
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
