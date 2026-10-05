import "server-only";

import { getAirtableConfig } from "./config";

export type AirtableRecord<TFields extends Record<string, unknown> = Record<string, unknown>> = {
  id: string;
  createdTime: string;
  fields: TFields;
};

type AirtableListResponse = {
  records: AirtableRecord[];
  offset?: string;
};

function tableUrl(baseId: string, table: string) {
  return `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;
}

async function airtableRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const config = getAirtableConfig();
  if (!config.token) throw new Error("Airtable is not configured.");
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Airtable ${response.status}: ${text.slice(0, 500)}`);
  }
  return (await response.json()) as T;
}

export async function createAirtableRecord(
  table: string,
  fields: Record<string, unknown>,
) {
  const config = getAirtableConfig();
  if (!config.baseId) throw new Error("Airtable is not configured.");
  const data = await airtableRequest<{ records: AirtableRecord[] }>(
    tableUrl(config.baseId, table),
    {
      method: "POST",
      body: JSON.stringify({ records: [{ fields }], typecast: true }),
    },
  );
  const record = data.records[0];
  if (!record) throw new Error("Airtable did not return the created record.");
  return record;
}

export async function updateAirtableRecord(
  table: string,
  recordId: string,
  fields: Record<string, unknown>,
) {
  const config = getAirtableConfig();
  if (!config.baseId) throw new Error("Airtable is not configured.");
  return airtableRequest<AirtableRecord>(
    `${tableUrl(config.baseId, table)}/${encodeURIComponent(recordId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ fields, typecast: true }),
    },
  );
}

export async function getAirtableRecord(table: string, recordId: string) {
  const config = getAirtableConfig();
  if (!config.baseId) throw new Error("Airtable is not configured.");
  return airtableRequest<AirtableRecord>(
    `${tableUrl(config.baseId, table)}/${encodeURIComponent(recordId)}`,
  );
}

export async function listAirtableRecords(
  table: string,
  options?: { filterByFormula?: string; maxRecords?: number },
) {
  const config = getAirtableConfig();
  if (!config.baseId) throw new Error("Airtable is not configured.");
  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (offset) params.set("offset", offset);
    if (options?.filterByFormula) params.set("filterByFormula", options.filterByFormula);
    if (options?.maxRecords) {
      params.set("maxRecords", String(options.maxRecords));
    }
    const page = await airtableRequest<AirtableListResponse>(
      `${tableUrl(config.baseId, table)}?${params}`,
    );
    records.push(...page.records);
    offset = page.offset;
  } while (offset && (!options?.maxRecords || records.length < options.maxRecords));
  return options?.maxRecords ? records.slice(0, options.maxRecords) : records;
}
