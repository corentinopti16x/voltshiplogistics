import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages/messages";

/**
 * Thin wrapper over the Anthropic Messages API used by the pricing assistant.
 * Server only: reads ANTHROPIC_API_KEY / ANTHROPIC_MODEL from the environment.
 */

export const ASSISTANT_NOT_CONFIGURED = "Assistant tarifs non configuré (ANTHROPIC_API_KEY)";
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5";

export class AssistantNotConfiguredError extends Error {
  constructor() {
    super(ASSISTANT_NOT_CONFIGURED);
    this.name = "AssistantNotConfiguredError";
  }
}

export type ImageMime = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export type AssistantInput =
  | { type: "text"; text: string }
  | { type: "image"; mime: ImageMime; base64: string }
  | { type: "pdf"; base64: string; title?: string };

export function isAssistantConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function getAssistantModel() {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL;
}

function toBlock(input: AssistantInput): ContentBlockParam {
  switch (input.type) {
    case "text":
      return { type: "text", text: input.text };
    case "image":
      return {
        type: "image",
        source: { type: "base64", media_type: input.mime, data: input.base64 },
      };
    case "pdf":
      return {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: input.base64 },
        title: input.title ?? null,
      };
  }
}

/** Pull the first JSON object out of a model reply (tolerates code fences / prose). */
export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("Model reply is not JSON.");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

export type JsonMessageResult<T> = {
  json: T;
  rawText: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
};

/**
 * `messages.create`-like helper with a JSON-only contract: the system prompt must ask
 * for a single JSON object; the reply is parsed and returned as `json`.
 */
export async function createJsonMessage<T = unknown>(options: {
  system: string;
  inputs: AssistantInput[];
  maxTokens?: number;
  temperature?: number;
}): Promise<JsonMessageResult<T>> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new AssistantNotConfiguredError();

  const client = new Anthropic({ apiKey });
  const model = getAssistantModel();
  const response = await client.messages.create({
    model,
    max_tokens: options.maxTokens ?? 16_000,
    temperature: options.temperature ?? 0,
    system: `${options.system}\n\nReply with a single JSON object and nothing else: no prose, no markdown fences.`,
    messages: [{ role: "user", content: options.inputs.map(toBlock) }],
  });

  const rawText = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
  if (!rawText) throw new Error("Empty model reply.");

  return {
    json: extractJson(rawText) as T,
    rawText,
    model: response.model,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}
