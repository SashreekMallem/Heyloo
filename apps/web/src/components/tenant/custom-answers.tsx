import { readCustomAnswers } from "@/lib/settings/custom-questions";

/**
 * INTAKE-Q-1: what the caller answered to the owner's custom intake questions
 * (`structured_payload.custom_answers` on a booking, or on the call's
 * `structured_booking_payload` for a message). The question text shown is the
 * owner's wording captured at the time (the server, not the AI, writes it).
 * Renders nothing when there are no answers, so callers can drop it in
 * unconditionally. React escapes the text; nothing here is ever HTML.
 */
export function CustomAnswersList({ payload }: { payload: unknown }) {
  const answers = readCustomAnswers(payload);
  if (answers.length === 0) return null;
  return (
    <dl className="space-y-2 text-sm" data-testid="custom-answers">
      {answers.map((entry, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the same question id can appear on two saved rows
        <div key={`${entry.question_id}-${index}`}>
          <dt className="text-muted-foreground">{entry.question}</dt>
          <dd>{entry.answer}</dd>
        </div>
      ))}
    </dl>
  );
}
