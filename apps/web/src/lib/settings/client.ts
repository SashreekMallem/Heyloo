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
export const SAVED_NEEDS_PUBLISH = "Saved — click “Publish changes” to update your live agent.";
export const SAVED_NOT_LIVE = "Saved. Your AI doesn't use this yet — see the note on this page.";
