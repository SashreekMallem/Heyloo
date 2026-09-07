/**
 * Scraped-content sanitization (G21, BACKEND_SPEC §7.8): "strip/escape
 * anything resembling a system-prompt override, e.g. text containing
 * 'ignore previous instructions' or role-play framing, before it ever
 * reaches a dynamic variable or prompt fragment." Applied to every piece of
 * scraped-site text before it's handed to the extraction LLM pass or
 * injected into a demo agent's dynamic variables — a prompt-injection
 * defense specific to the one place this codebase ingests arbitrary
 * third-party text into an LLM context (SYSTEM_DESIGN §7 G6/G21).
 */

const INSTRUCTION_OVERRIDE_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+instructions?/gi,
  /disregard\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+instructions?/gi,
  /you\s+are\s+now\s+(a|an)\s+/gi,
  /forget\s+(everything|all)\s+(you\s+)?(know|were\s+told)/gi,
  /system\s*:\s*/gi,
  /assistant\s*:\s*/gi,
  /\[?\s*new\s+instructions?\s*\]?\s*:/gi,
  /act\s+as\s+(if\s+you\s+are\s+|a\s+|an\s+)/gi,
  /pretend\s+(to\s+be|you\s+are)/gi,
  /<\s*\/?\s*system\s*>/gi,
];

const REDACTION = "[redacted]";

export function sanitizeScrapedContent(text: string): string {
  let sanitized = text;
  for (const pattern of INSTRUCTION_OVERRIDE_PATTERNS) {
    sanitized = sanitized.replace(pattern, REDACTION);
  }
  return sanitized;
}
