import { z } from "zod";

/**
 * Agent → Greeting & Persona (FRONTEND_SPEC.md §6.6). The disclosure
 * sentence itself is compiler-enforced (SYSTEM_DESIGN §4.5/§7) and is
 * deliberately NOT a field here — only `persona_name` interpolates into it.
 */
export const agentGreetingSchema = z.object({
  persona_name: z.string().trim().min(1, "Give your AI assistant a name").max(60),
});

export type AgentGreeting = z.infer<typeof agentGreetingSchema>;
