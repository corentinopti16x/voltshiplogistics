/**
 * ECCANG WMS SOAP 1.1 protocol — pure functions (no network, no server-only) so the
 * envelope builder and the response parser can be unit-tested with fixtures.
 *
 * Request:  POST http://<host>/default/svc/web-service
 *           <ns1:callService> { paramsJson (JSON string), appToken, appKey, service, language }
 * Response: the JSON document is returned as text inside the SOAP body
 *           (XML-escaped), shaped { ask: "Success" | "Failure", message, data?, Error?, ... }.
 */

export type EccangCredentials = { appKey: string; appToken: string };

export type EccangError = { errCode?: string; errMessage?: string };

export type EccangResponse<T = unknown> = {
  ask: "Success" | "Failure";
  message?: string;
  data?: T;
  Error?: EccangError;
  count?: number | string;
  nextPage?: boolean | string;
  pagination?: { page?: number | string; pageSize?: number | string };
  [key: string]: unknown;
};

export const ECCANG_SERVICE_PATH = "/default/svc/web-service";

export function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const namedEntities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function unescapeXml(value: string) {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(parseInt(entity.slice(1), 10));
    return namedEntities[entity] ?? match;
  });
}

/** Normalises `http(s)://host[/...]` or a bare host into the service endpoint URL. */
export function eccangEndpoint(host: string) {
  const trimmed = host.trim().replace(/\/+$/, "");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const url = new URL(withScheme);
  return `${url.protocol}//${url.host}${ECCANG_SERVICE_PATH}`;
}

export function buildEnvelope(input: {
  credentials: EccangCredentials;
  service: string;
  params: unknown;
  language?: "en_US" | "zh_CN";
}) {
  const paramsJson = JSON.stringify(input.params ?? {});
  const language = input.language ?? "en_US";
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="http://www.example.org/Ec/">` +
    `<SOAP-ENV:Body><ns1:callService>` +
    `<paramsJson>${escapeXml(paramsJson)}</paramsJson>` +
    `<appToken>${escapeXml(input.credentials.appToken)}</appToken>` +
    `<appKey>${escapeXml(input.credentials.appKey)}</appKey>` +
    `<service>${escapeXml(input.service)}</service>` +
    `<language>${language}</language>` +
    `</ns1:callService></SOAP-ENV:Body></SOAP-ENV:Envelope>`
  );
}

/**
 * Extracts the JSON document ECCANG embeds in the SOAP body. Handles `<response>`,
 * `<return>`, `<ns1:response>` wrappers, CDATA and XML-escaped payloads, and a SOAP
 * Fault. Falls back to the first `{...}` block when the wrapper tag is unknown.
 */
export function parseResponse<T = unknown>(xml: string): EccangResponse<T> {
  const text = xml.trim();
  const fault = text.match(/<(?:[\w-]+:)?Fault>([\s\S]*?)<\/(?:[\w-]+:)?Fault>/);
  if (fault) {
    const faultString =
      fault[1].match(/<faultstring>([\s\S]*?)<\/faultstring>/)?.[1] ?? "SOAP fault";
    return {
      ask: "Failure",
      message: unescapeXml(faultString).trim(),
      Error: { errCode: "SOAP_FAULT", errMessage: unescapeXml(faultString).trim() },
    };
  }

  let body: string | null = null;
  const wrapped = text.match(
    /<(?:[\w-]+:)?(?:response|return|result|callServiceResponse)[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?(?:response|return|result|callServiceResponse)>/,
  );
  if (wrapped) body = wrapped[1];
  if (body) {
    const inner = body.match(
      /<(?:[\w-]+:)?(?:response|return|result)[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?(?:response|return|result)>/,
    );
    if (inner) body = inner[1];
  }
  let candidate = body ?? text;
  const cdata = candidate.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (cdata) candidate = cdata[1];
  candidate = unescapeXml(candidate).trim();
  if (!candidate.startsWith("{") && !candidate.startsWith("[")) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end === -1) {
      throw new Error("ECCANG response did not contain a JSON document.");
    }
    candidate = candidate.slice(start, end + 1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error("ECCANG response JSON could not be parsed.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("ECCANG response JSON is not an object.");
  }
  const record = parsed as Record<string, unknown>;
  const ask = String(record.ask ?? "").toLowerCase() === "success" ? "Success" : "Failure";
  return { ...(record as EccangResponse<T>), ask };
}

export function errorMessage(response: EccangResponse) {
  const err = response.Error;
  const parts = [err?.errCode, err?.errMessage ?? response.message].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  );
  return parts.length ? parts.join(": ") : "ECCANG returned Failure.";
}
