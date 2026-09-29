/**
 * Plain-text -> minimal HTML for transactional email (MESSAGING-1). Every
 * body the `messages_outbound` worker emails is a rendered template that
 * can carry caller-supplied text (a caller's message, a customer name), so
 * it is ALWAYS escaped — the previous `<p>${body}</p>` let a caller inject
 * markup into the owner's inbox.
 */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

/** Paragraphs split on blank lines, single newlines kept as `<br>`. */
export function textToEmailHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
