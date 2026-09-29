/**
 * SETTINGS-1: browser-side helpers shared by the owner-settings forms —
 * one POST helper that surfaces the routes' 422 `issues` so a form can
 * highlight the exact field, and the save messages every tab uses (the
 * old "Saved — updating your AI, ~30s" was wrong for every tab: most
 * settings are live on the next call, the call language needs Publish,
 * and hours only changed at the nightly rebuild).
 */

export interface SaveIssue {
  path: Array<string | number>;
  message: string;
}

export interface SaveResult<T = unknown> {
  ok: boolean;
  status: number;
  body: T | null;
  issues: SaveIssue[];
  error: string | null;
}

export async function sendJson<T = unknown>(
  url: string,
  body: unknown,
  method: "POST" | "PATCH" | "DELETE" = "POST",
): Promise<SaveResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = (await res.json().catch(() => null)) as
      | (T & { error?: string; issues?: SaveIssue[] })
      | null;
    return {
      ok: res.ok,
      status: res.status,
      body: json,
      issues: Array.isArray(json?.issues) ? json.issues : [],
      error: typeof json?.error === "string" ? json.error : null,
    };
  } catch {
    return { ok: false, status: 0, body: null, issues: [], error: "network_error" };
  }
}

export function saveErrorMessage(result: Pick<SaveResult, "status" | "error">): string {
  if (result.error === "owner_or_admin_required") {
    return "Only an owner or admin can change these settings.";
  }
  if (result.status === 422) return "Please fix the highlighted fields.";
  if (result.error === "not_available_yet") {
    return "This setting isn't available yet — it will be after the next platform update.";
  }
  if (result.status === 401) return "Your session expired — sign in again.";
  return "Couldn't save — please try again.";
}

/** Pushes route issues onto react-hook-form fields (dot-joined paths). */
export function applyIssues(
  issues: SaveIssue[],
  setError: (name: never, error: { type: string; message: string }) => void,
  map: (path: string) => string | null = (path) => path,
): number {
  let applied = 0;
  for (const issue of issues) {
    const name = map(issue.path.join("."));
    if (!name) continue;
    setError(name as never, { type: "server", message: issue.message });
    applied++;
  }
  return applied;
}

export const SAVED_NEXT_CALL = "Saved — your AI uses this from the next call.";
export const SAVED_NEXT_TEXT = "Saved — your text agent uses this from the next message.";
/** INTAKE-Q-1: the live agent predates custom questions, so it needs one publish before it asks them. */
export const SAVED_QUESTIONS_NEED_PUBLISH =
  "Saved — publish your agent once (“Publish changes” above) and it will start asking these questions.";
export const SAVED_NEEDS_PUBLISH = "Saved — click “Publish changes” to update your live agent.";

/** QA-1 F-5: shown when a browser-client write touched zero rows (RLS silently filters a `member`'s write). */
export const NOT_ALLOWED_TO_CHANGE = "Only an owner or admin can change this.";

/**
 * A browser-client `.update(...).select("id")` outcome. RLS filters a write
 * the caller isn't allowed to make down to ZERO rows and PostgREST reports
 * no error, so `error === null` is not proof anything was saved (QA-1 F-5:
 * a member got "Saved" while the value stayed put).
 */
export function browserWriteOutcome(result: {
  data: unknown;
  error: unknown;
}): "ok" | "denied" | "error" {
  if (result.error) return "error";
  return Array.isArray(result.data) && result.data.length > 0 ? "ok" : "denied";
}
