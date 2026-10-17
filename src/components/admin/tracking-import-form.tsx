"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { pushTrackingChunkAction } from "@/app/actions/tracking-import";
import {
  chunkRows,
  MAX_TRACKING_ROWS,
  parseTrackingFile,
  type TrackingParseResult,
} from "@/lib/shopify/tracking-import";
import type { TrackingPushResult, TrackingPushStatus } from "@/lib/shopify/tracking-import-server";
import { Badge, Button } from "@/components/ui";

export type TrackingClientOption = { id: string; name: string; shops: Array<{ id: string; domain: string }> };

const field = "rounded-lg border border-[var(--line)] bg-white px-2.5 py-1.5 text-[13px]";
const STATUSES: TrackingPushStatus[] = ["fulfilled", "already_fulfilled", "not_found", "ambiguous", "error"];

function csvCell(value: string | number | undefined) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function TrackingImportForm({ clients }: { clients: TrackingClientOption[] }) {
  const t = useTranslations("admin.trackingPage");
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [shopId, setShopId] = useState("");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);
  const [consent, setConsent] = useState(false);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [results, setResults] = useState<TrackingPushResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef(false);

  const client = clients.find((c) => c.id === clientId) ?? null;
  const parsed: TrackingParseResult | null = useMemo(() => (text.trim() ? parseTrackingFile(text) : null), [text]);
  const rows = parsed?.rows ?? [];
  const tooMany = rows.length > MAX_TRACKING_ROWS;
  const counts = useMemo(() => {
    const map = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<TrackingPushStatus, number>;
    for (const result of results) map[result.status] += 1;
    return map;
  }, [results]);
  const problems = results.filter((r) => r.status !== "fulfilled" && r.status !== "already_fulfilled");

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError(t("errors.fileTooLarge"));
      return;
    }
    setFileName(file.name);
    setText(await file.text());
    setResults([]);
    setDone(0);
    setError(null);
  }

  async function start() {
    if (!client || rows.length === 0 || tooMany || !consent) return;
    setRunning(true);
    setError(null);
    setResults([]);
    setDone(0);
    stopRef.current = false;
    for (const chunk of chunkRows(rows)) {
      if (stopRef.current) break;
      const response = await pushTrackingChunkAction({
        clientId: client.id,
        shopId: shopId || null,
        notify,
        consent,
        rows: chunk,
      }).catch((reason: unknown) => ({
        ok: false as const,
        error: reason instanceof Error ? reason.message : String(reason),
        results: undefined,
        code: undefined,
      }));
      if (!response.ok || !response.results) {
        setError(response.code ? t(`errors.${response.code}`) : (response.error ?? t("errors.unknown")));
        break;
      }
      const chunkResults = response.results;
      setResults((current) => [...current, ...chunkResults]);
      setDone((current) => current + chunk.length);
    }
    setRunning(false);
  }

  function downloadReport() {
    const header = ["line", "order", "tracking", "status", "shop", "message"];
    const lines = [header.join(",")].concat(
      results.map((r) => [r.line, r.order, r.tracking, r.status, r.shop, r.message].map(csvCell).join(",")),
    );
    const blob = new Blob([`﻿${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `suivis-shopify-${client?.name ?? "client"}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (clients.length === 0) {
    return <p className="text-sm text-[var(--muted)]">{t("noClients")}</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="grid gap-4 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("client")}</span>
          <select
            className={field}
            value={clientId}
            disabled={running}
            onChange={(event) => {
              setClientId(event.target.value);
              setShopId("");
              setConsent(false);
              setResults([]);
              setDone(0);
            }}
          >
            {clients.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name} ({option.shops.length})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("shop")}</span>
          <select className={field} value={shopId} disabled={running} onChange={(event) => setShopId(event.target.value)}>
            <option value="">{t("allShops")}</option>
            {(client?.shops ?? []).map((shop) => (
              <option key={shop.id} value={shop.id}>
                {shop.domain}
              </option>
            ))}
          </select>
          <span className="text-xs text-[var(--muted)]">{t("shopHint")}</span>
        </label>
        <label className="flex flex-col gap-1 text-sm md:col-span-2">
          <span className="font-medium">{t("file")}</span>
          <input
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            disabled={running}
            onChange={(event) => void onFile(event.target.files?.[0])}
            className="text-[13px]"
          />
          <span className="text-xs text-[var(--muted)]">{t("fileHint")}</span>
        </label>
        <label className="flex flex-col gap-1 text-sm md:col-span-2">
          <span className="font-medium">{t("paste")}</span>
          <textarea
            className={`${field} min-h-24 font-mono`}
            value={text}
            disabled={running}
            placeholder={"Order Name,Shopify Order ID,Tracking Number,Tracking Company\n#14236,8272336093523,YT2628600709437318,YunExpress"}
            onChange={(event) => {
              setText(event.target.value);
              setFileName(null);
              setResults([]);
              setDone(0);
            }}
          />
        </label>
      </section>

      {parsed ? (
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 text-sm">
          {parsed.missingColumns.length ? (
            <p className="text-[var(--rust-ink)]">
              {t("missingColumns", { columns: parsed.missingColumns.map((c) => t(`columns.${c}`)).join(", ") })}
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {fileName ? <span className="font-mono text-xs text-[var(--muted)]">{fileName}</span> : null}
              <Badge tone="navy">{t("preview.rows", { count: rows.length })}</Badge>
              {parsed.duplicates ? <Badge tone="grey">{t("preview.duplicates", { count: parsed.duplicates })}</Badge> : null}
              {parsed.invalid.length ? (
                <Badge tone="gold">
                  {t("preview.invalid", {
                    count: parsed.invalid.length,
                    lines: parsed.invalid
                      .slice(0, 8)
                      .map((item) => item.line)
                      .join(", "),
                  })}
                </Badge>
              ) : null}
              {tooMany ? <Badge tone="rust">{t("preview.tooMany", { max: MAX_TRACKING_ROWS })}</Badge> : null}
            </div>
          )}
        </section>
      ) : null}

      <section className="flex flex-col gap-3 rounded-2xl border border-[var(--gold-soft)] bg-[var(--card)] p-5 text-sm">
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={notify} disabled={running} onChange={(event) => setNotify(event.target.checked)} />
          <span>{t("notify")}</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={consent} disabled={running} onChange={(event) => setConsent(event.target.checked)} />
          <span>{t("consent", { client: client?.name ?? "" })}</span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void start()} disabled={running || !consent || rows.length === 0 || tooMany || !client}>
            {running ? t("running", { done, total: rows.length }) : t("start", { count: rows.length })}
          </Button>
          {running ? (
            <Button variant="secondary" onClick={() => (stopRef.current = true)}>
              {t("stop")}
            </Button>
          ) : null}
          {results.length > 0 && !running ? (
            <Button variant="secondary" onClick={downloadReport}>
              {t("download")}
            </Button>
          ) : null}
        </div>
        {running || done > 0 ? (
          <div className="h-2 overflow-hidden rounded-full bg-[var(--line)]">
            <div
              className="h-full bg-[var(--navy)] transition-all"
              style={{ width: `${rows.length ? Math.round((done / rows.length) * 100) : 0}%` }}
            />
          </div>
        ) : null}
        {error ? <p className="text-[var(--rust-ink)]">{error}</p> : null}
      </section>

      {results.length > 0 ? (
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
          <div className="flex flex-wrap gap-2">
            {STATUSES.filter((status) => counts[status] > 0).map((status) => (
              <Badge
                key={status}
                tone={status === "fulfilled" ? "green" : status === "already_fulfilled" ? "grey" : "rust"}
              >
                {t(`status.${status}`)} · {counts[status]}
              </Badge>
            ))}
          </div>
          {problems.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs text-[var(--muted)]">
                  <tr className="border-b border-[var(--line)]">
                    <th className="py-2 pr-3 font-medium">{t("table.line")}</th>
                    <th className="py-2 pr-3 font-medium">{t("table.order")}</th>
                    <th className="py-2 pr-3 font-medium">{t("table.tracking")}</th>
                    <th className="py-2 pr-3 font-medium">{t("table.status")}</th>
                    <th className="py-2 font-medium">{t("table.message")}</th>
                  </tr>
                </thead>
                <tbody>
                  {problems.slice(0, 300).map((result) => (
                    <tr key={`${result.line}-${result.order}`} className="border-b border-[var(--line)] last:border-0">
                      <td className="py-2 pr-3 text-xs">{result.line}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{result.order}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{result.tracking}</td>
                      <td className="py-2 pr-3">
                        <Badge tone="rust">{t(`status.${result.status}`)}</Badge>
                      </td>
                      <td className="py-2 text-xs text-[var(--muted)]">{result.message ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-sm text-[var(--muted)]">{t("allGood")}</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
