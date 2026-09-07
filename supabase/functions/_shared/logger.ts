import type { LogFields, Logger } from "./types.js";

/**
 * Structured JSON logger. One line per event (`console.*` on Supabase Edge
 * Functions is captured as structured log lines by the platform), never
 * multi-line/pretty output which would break log ingestion parsing.
 */
export function createLogger(base: LogFields = {}): Logger {
  const emit = (level: string, msg: string, fields?: LogFields): void => {
    const line = JSON.stringify({
      level,
      msg,
      ts: new Date().toISOString(),
      ...base,
      ...fields,
    });
    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  };

  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
  };
}
