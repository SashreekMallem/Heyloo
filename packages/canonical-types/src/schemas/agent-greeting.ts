import { z } from "zod";

/**
 * Agent → Greeting & Persona (FRONTEND_SPEC.md §6.6). The disclosure
 * sentence itself is compiler-enforced (SYSTEM_DESIGN §4.5/§7) and is
 * deliberately NOT a field here — only `persona_name` interpolates into it.
 *
 * QA-1 F-9: blank is allowed — the page promises "if left blank, callers
 * hear Ava", and every reader (`voice-inbound`, the text agent) already
 * falls back to the default name for a null/empty `assistant_name`, so the
 * page stores blank as `null`.
 */
export const agentGreetingSchema = z.object({
  persona_name: z.string().trim().max(60, "Keep the name to 60 characters or fewer"),
});

export type AgentGreeting = z.infer<typeof agentGreetingSchema>;
