import { htmlToPlainText } from "../_shared/html-text.ts";
import { extractJsonObject } from "../_shared/json-extract.ts";
import type { AnthropicContentBlock, AnthropicFetch } from "../_shared/providers/anthropic.ts";
import { createMessageWithContent } from "../_shared/providers/anthropic.ts";
import {
  type MenuImportCandidate,
  MenuImportExtractionSchema,
  type MenuImportRequest,
} from "../_shared/schemas/menu-import.ts";
import type { Logger } from "../_shared/types.ts";

/**
 * `/api-menu-import` core logic (GAP_REGISTER Cluster G item 3): tenant
 * uploads a menu (as extracted plain text today, or a PDF/photo/URL via
 * this task's richer `source` mode), and Anthropic extracts a structured
 * list of candidate offerings. NEVER writes to `public.offerings` itself —
 * this only returns candidates (`{items: [...]}`, matching the exact shape
 * `apps/web`'s already-built import UI/proxy expects per
 * docs/audit/FIX_REQUESTS.md — no reshaping needed before its own
 * `POST /api/tenant/offerings/bulk` persists a reviewed/edited row); the
 * tenant owner reviews/edits/confirms each one before anything publishes,
 * matching every other "extraction is a proposal, not a write" pattern in
 * this codebase (e.g. the demo-agent's hours/services extraction).
 */

const SYSTEM_PROMPT = `You extract a restaurant/business menu into strict JSON. Read the provided content (raw menu text, a URL's page text, or a photo/PDF of a menu) and return ONLY a JSON object of the exact shape:
{"items": [{"name": string, "category"?: string, "price_cents"?: integer, "duration_minutes"?: integer, "allergens"?: string[], "modifiers"?: [{"name": string, "price_cents"?: integer}]}]}
Rules:
- price_cents is the price in CENTS (e.g. $12.50 -> 1250), omit if no price is shown.
- category is the menu section the item appears under (e.g. "Appetizers"), omit if unclear.
- duration_minutes only applies to a bookable service (e.g. a spa/salon menu), omit for food/retail items.
- allergens is a short list of named allergens explicitly called out for that item (e.g. "gluten", "peanuts"), omit if none are noted.
- modifiers are named add-ons/options with their own price (e.g. "Extra cheese" +$1.50), omit if none.
- Include every distinct menu item you can identify. Do not invent items that aren't present.
- Output ONLY the JSON object — no markdown fences, no commentary, no leading/trailing text.`;

export interface MenuImportDeps {
  anthropicFetch: AnthropicFetch;
  anthropicApiKey: string;
  anthropicModel: string;
  /** Injected so URL-source extraction is unit-testable without a real
   * network fetch — production wiring passes the global `fetch`. */
  urlFetch: (url: string) => Promise<{ ok: boolean; status: number; text: string }>;
  logger: Logger;
}

export type MenuImportResult =
  | { status: 200; body: { items: MenuImportCandidate[] } }
  | { status: 422; body: { error: "url_unreachable" | "unparseable_extraction" } }
  | { status: 502; body: { error: "extraction_failed" } };

export async function importMenu(
  input: MenuImportRequest,
  deps: MenuImportDeps,
): Promise<MenuImportResult> {
  let content: AnthropicContentBlock[];

  if (input.raw_text) {
    content = [{ type: "text", text: `Menu text:\n\n${input.raw_text}` }];
  } else if (input.source?.kind === "url") {
    const page = await deps.urlFetch(input.source.url);
    if (!page.ok) {
      deps.logger.warn("menu_import_url_unreachable", {
        url: input.source.url,
        status: page.status,
      });
      return { status: 422, body: { error: "url_unreachable" } };
    }
    const pageText = htmlToPlainText(page.text, 20_000);
    content = [{ type: "text", text: `Menu page content:\n\n${pageText}` }];
  } else if (input.source?.kind === "file") {
    const block: AnthropicContentBlock =
      input.source.media_type === "application/pdf"
        ? {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: input.source.data_base64,
            },
          }
        : {
            type: "image",
            source: {
              type: "base64",
              media_type: input.source.media_type,
              data: input.source.data_base64,
            },
          };
    content = [block, { type: "text", text: "Extract the menu from the attached file." }];
  } else {
    // Unreachable given MenuImportRequestSchema's own refine (raw_text or
    // source required) — fails closed rather than calling Anthropic with
    // nothing to extract from.
    return { status: 422, body: { error: "unparseable_extraction" } };
  }

  const result = await createMessageWithContent(deps.anthropicFetch, deps.anthropicApiKey, {
    model: deps.anthropicModel,
    maxTokens: 4096,
    system: SYSTEM_PROMPT,
    content,
  });

  if (!result.ok || !result.text) {
    deps.logger.error("menu_import_extraction_call_failed", { status: result.status });
    return { status: 502, body: { error: "extraction_failed" } };
  }

  let raw: unknown;
  try {
    raw = extractJsonObject(result.text);
  } catch {
    deps.logger.warn("menu_import_unparseable_response", {});
    return { status: 422, body: { error: "unparseable_extraction" } };
  }

  const parsed = MenuImportExtractionSchema.safeParse(raw);
  if (!parsed.success) {
    deps.logger.warn("menu_import_extraction_schema_mismatch", { issues: parsed.error.issues });
    return { status: 422, body: { error: "unparseable_extraction" } };
  }

  return { status: 200, body: { items: parsed.data.items } };
}
