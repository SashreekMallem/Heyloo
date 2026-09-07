import { z } from "zod";

/**
 * Agent → Language (FRONTEND_SPEC.md §6.6) — the agent's SPOKEN CALL
 * language, a per-tenant business setting. Explicitly NOT the dashboard UI
 * locale (`next-intl` `[locale]`, §0.6) — never conflate the two. `es` is
 * listed but disabled in the UI ("Coming soon") until gap G12 ships.
 */
export const AGENT_LANGUAGES = ["en", "es"] as const;
export type AgentLanguage = (typeof AGENT_LANGUAGES)[number];

export const agentLanguageSchema = z.object({
  language: z.enum(AGENT_LANGUAGES),
});

export type AgentLanguageInput = z.infer<typeof agentLanguageSchema>;
