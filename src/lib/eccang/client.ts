import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { decryptEccangToken } from "@/lib/eccang/crypto";
import {
  buildEnvelope,
  eccangEndpoint,
  errorMessage,
  parseResponse,
  type EccangCredentials,
  type EccangResponse,
} from "@/lib/eccang/protocol";

export type { EccangCredentials, EccangResponse } from "@/lib/eccang/protocol";

const TIMEOUT_MS = 20_000;

export class EccangApiError extends Error {
  readonly errCode: string | null;
  readonly errMessage: string | null;
  readonly service: string;
  constructor(service: string, response: EccangResponse) {
    super(`ECCANG ${service}: ${errorMessage(response)}`);
    this.name = "EccangApiError";
    this.service = service;
    this.errCode = response.Error?.errCode ?? null;
    this.errMessage = response.Error?.errMessage ?? response.message ?? null;
  }
}

export function eccangHost() {
  const host = process.env.ECCANG_API_HOST?.trim();
  if (!host) throw new Error("ECCANG_API_HOST is not configured.");
  return host;
}

export function isEccangConfigured() {
  return Boolean(process.env.ECCANG_API_HOST?.trim());
}

/**
 * One SOAP call. Returns the parsed response when `ask === "Success"`, otherwise throws
 * an EccangApiError carrying errCode / errMessage. Network failures and the 20 s timeout
 * throw plain Errors.
 */
export async function callEccang<T = unknown>(
  creds: EccangCredentials,
  service: string,
  params: unknown,
  options: { host?: string; language?: "en_US" | "zh_CN"; allowFailure?: boolean } = {},
): Promise<EccangResponse<T>> {
  const url = eccangEndpoint(options.host ?? eccangHost());
  const body = buildEnvelope({ credentials: creds, service, params, language: options.language });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let text: string;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "",
      },
      body,
      cache: "no-store",
      signal: controller.signal,
    });
    text = await response.text();
    if (!response.ok && !text.includes("ask")) {
      throw new Error(`ECCANG ${service}: HTTP ${response.status} ${text.slice(0, 300)}`);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`ECCANG ${service}: timed out after ${TIMEOUT_MS / 1000}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const parsed = parseResponse<T>(text);
  if (parsed.ask !== "Success" && !options.allowFailure) {
    throw new EccangApiError(service, parsed);
  }
  return parsed;
}

export type ClientEccangConfig = {
  clientId: string;
  clientCode: string | null;
  enabled: boolean;
  warehouseCode: string | null;
  credentials: EccangCredentials | null;
};

/** Loads and decrypts the per-client ECCANG credentials (service_role only). */
export async function getCredentialsForClient(clientId: string): Promise<ClientEccangConfig> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clients")
    .select("id, code, eccang_app_key, eccang_app_token_encrypted, eccang_warehouse_code, eccang_enabled")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Client not found.");
  const credentials =
    data.eccang_app_key && data.eccang_app_token_encrypted
      ? { appKey: data.eccang_app_key, appToken: decryptEccangToken(data.eccang_app_token_encrypted) }
      : null;
  return {
    clientId: data.id,
    clientCode: data.code ?? null,
    enabled: Boolean(data.eccang_enabled),
    warehouseCode: data.eccang_warehouse_code ?? null,
    credentials,
  };
}

export function requireEccangClient(config: ClientEccangConfig) {
  if (!config.credentials) throw new Error("ECCANG credentials are not set for this client.");
  if (!config.warehouseCode) throw new Error("ECCANG warehouse code is not set for this client.");
  return { credentials: config.credentials, warehouseCode: config.warehouseCode };
}

// --- Thin typed wrappers over the services used by the integration -------------------

export type EccangWarehouse = {
  warehouse_code: string;
  warehouse_name: string;
  country_code?: string;
  warehouse_status?: number | string;
};

export type EccangShippingMethod = {
  code: string;
  name?: string;
  name_en?: string;
  warehouse_code?: string;
};

export async function getWarehouses(creds: EccangCredentials) {
  const response = await callEccang<EccangWarehouse[]>(creds, "getWarehouse", {});
  return Array.isArray(response.data) ? response.data : [];
}

export async function getShippingMethods(creds: EccangCredentials, warehouseCode?: string | null) {
  const response = await callEccang<EccangShippingMethod[]>(
    creds,
    "getShippingMethod",
    warehouseCode ? { warehouseCode } : {},
  );
  return Array.isArray(response.data) ? response.data : [];
}
