import { describe, expect, it } from "vitest";
import { escapeHtml, textToEmailHtml } from "./email-body.ts";

describe("email body rendering", () => {
  it("escapes every HTML-significant character", () => {
    expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;",
    );
  });

  it("turns blank-line-separated text into paragraphs and keeps single newlines", () => {
    expect(textToEmailHtml("Hello\nthere\n\n<b>bye</b>")).toBe(
      "<p>Hello<br>there</p><p>&lt;b&gt;bye&lt;/b&gt;</p>",
    );
  });
});
