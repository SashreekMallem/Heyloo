/**
 * Read-side normalizer for `call_logs.transcript` (QA-1 F-3 / MAP-02).
 *
 * The canonical shape is `{ speaker, text, ts }`, but the rows written by
 * `voice-events` so far hold the voice provider's turn array verbatim
 * (`[{ role, content, words: [{ start }] }]`), so every real call rendered as
 * blank rows reading "NaN:NaN". This maps BOTH shapes to the canonical turn
 * the transcript viewer expects, and never throws on malformed input:
 *
 *   - speaker: `agent`/`assistant`/`ai`/`bot` -> "AI assistant";
 *              `user`/`caller`/`customer` -> "Caller"; anything else keeps its
 *              own (title-cased) label.
 *   - text:    `text` ?? `content`.
 *   - ts:      `ts` (seconds) ?? first word's `start` ?? 0.
 *
 * Turns with no text are dropped. (Normalizing at the write boundary — the
 * provider adapter — is tracked in docs/BUILD_NOTES.md; this keeps every
 * already-stored row readable regardless.)
 */

export interface NormalizedTurn {
  speaker: string;
  text: string;
  ts: number;
}

export const AGENT_LABEL = "AI assistant";
export const CALLER_LABEL = "Caller";

export function speakerLabel(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  const key = value.toLowerCase();
  if (["agent", "assistant", "ai", "bot", "ai assistant"].includes(key)) return AGENT_LABEL;
  if (["user", "caller", "customer", "human"].includes(key)) return CALLER_LABEL;
  if (!value) return "Unknown";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function firstWordStart(words: unknown): number | null {
  if (!Array.isArray(words) || words.length === 0) return null;
  const first = words[0] as { start?: unknown } | null;
  const start = first && typeof first === "object" ? Number(first.start) : Number.NaN;
  return Number.isFinite(start) && start >= 0 ? start : null;
}

export function normalizeTranscript(raw: unknown): NormalizedTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: NormalizedTurn[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const t = entry as Record<string, unknown>;
    const textValue = typeof t["text"] === "string" ? t["text"] : t["content"];
    const text = typeof textValue === "string" ? textValue.trim() : "";
    if (!text) continue;
    const tsRaw = Number(t["ts"]);
    const ts =
      t["ts"] !== undefined && t["ts"] !== null && Number.isFinite(tsRaw) && tsRaw >= 0
        ? tsRaw
        : (firstWordStart(t["words"]) ?? 0);
    turns.push({ speaker: speakerLabel(t["speaker"] ?? t["role"]), text, ts });
  }
  return turns;
}
