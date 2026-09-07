/**
 * Minimal HTML-to-plain-text extraction for the demo-agent scraper
 * (BACKEND_SPEC §7.8). Deliberately regex-based rather than a DOM/HTML
 * parser dependency — this only needs to strip markup and scripts/styles
 * to get a text blob for the sanitizer + extraction prompt, not build a
 * structured DOM.
 */
export function htmlToPlainText(html: string, maxLength = 8_000): string {
  const withoutScriptsAndStyles = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const withoutTags = withoutScriptsAndStyles.replace(/<[^>]+>/g, " ");
  const decoded = withoutTags
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  const collapsed = decoded.replace(/\s+/g, " ").trim();
  return collapsed.slice(0, maxLength);
}
