/**
 * SETTINGS-2 (docs/BUILD_NOTES.md): how much of the owner's FAQ the AI reads
 * on each call. The portal stores up to 50 entries / 20,000 characters, but
 * the call-time reader (`supabase/functions/_shared/agent-settings.ts`,
 * `resolveFaqText`) sends a bounded, sanitized slice — the entries that fit,
 * in the owner's order — so the prompt stays small and fast. These constants
 * mirror that file's; `faq-budget.test.ts` reads the source and fails on drift.
 */

export const FAQ_LIVE_MAX_ITEMS = 25;
export const FAQ_LIVE_MAX_CHARS = 4000;
export const FAQ_LIVE_QUESTION_MAX_CHARS = 200;
export const FAQ_LIVE_ANSWER_MAX_CHARS = 700;

export interface FaqBudgetItem {
  question: string;
  answer: string;
}

/**
 * How many of `items` (in order) the AI will actually read. Entries missing a
 * question or an answer are skipped, exactly like the runtime; the runtime's
 * additional character sanitizing can shave a few characters, so treat the
 * result as accurate to within one entry at the boundary.
 */
export function countFaqItemsAgentReads(items: FaqBudgetItem[]): number {
  let count = 0;
  let length = 0;
  for (const item of items) {
    if (count >= FAQ_LIVE_MAX_ITEMS) break;
    const question = item.question.trim().slice(0, FAQ_LIVE_QUESTION_MAX_CHARS);
    const answer = item.answer.trim().slice(0, FAQ_LIVE_ANSWER_MAX_CHARS);
    if (!question || !answer) continue;
    const next = length + `Q: ${question}\nA: ${answer}`.length + (count > 0 ? 2 : 0);
    if (next > FAQ_LIVE_MAX_CHARS) break;
    count += 1;
    length = next;
  }
  return count;
}
