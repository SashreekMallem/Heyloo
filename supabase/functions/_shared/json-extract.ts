/**
 * Shared "pull the JSON object out of a Claude text response" helper.
 * Originally written inline in `api-menu-import/handler.ts` (menu
 * extraction); lifted out here unchanged (OUTREACH-2) so the review-score
 * classifier (`job-outreach-review-score`) doesn't duplicate it — every
 * plain-text (non-tool-use) structured-extraction call site in this
 * codebase follows the same "ask for strict JSON, tolerate an accidental
 * markdown fence, throw on anything else" contract.
 */
export function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("no_json_object_found");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}
