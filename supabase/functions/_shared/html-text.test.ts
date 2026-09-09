import { describe, expect, it } from "vitest";
import { htmlToPlainText } from "./html-text.ts";

describe("htmlToPlainText", () => {
  it("strips tags, scripts, and styles", () => {
    const html =
      "<html><head><style>.a{color:red}</style></head><body><script>alert(1)</script><h1>Hi</h1><p>Open 9-5</p></body></html>";
    const result = htmlToPlainText(html);
    expect(result).toBe("Hi Open 9-5");
  });

  it("decodes common HTML entities", () => {
    expect(htmlToPlainText("<p>Tom &amp; Jerry&#39;s &quot;shop&quot;</p>")).toBe(
      'Tom & Jerry\'s "shop"',
    );
  });

  it("truncates to the max length", () => {
    const long = "a".repeat(10_000);
    expect(htmlToPlainText(`<p>${long}</p>`, 100)).toHaveLength(100);
  });
});
