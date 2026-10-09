import { afterEach, describe, expect, it, vi } from "vitest";
import { enqueuePrint, printHtml } from "./print";
import { TICKET_MARKER_ATTR } from "./ticket";

const TICKET = `<!doctype html><html><body ${TICKET_MARKER_ATTR}="1">ticket</body></html>`;

function fakePopup() {
  const doc = { open: vi.fn(), write: vi.fn(), close: vi.fn() };
  return {
    document: doc,
    focus: vi.fn(),
    print: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("printHtml (LIVE-1)", () => {
  it("prints from a hidden iframe when the frame holds the ticket", async () => {
    const print = vi.fn();
    // jsdom does not render `srcdoc`, so stand in for a browser that does:
    // mark the frame's document as the ticket before its load event fires.
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLIFrameElement && node.contentWindow && node.contentDocument) {
            node.contentDocument.body.setAttribute(TICKET_MARKER_ATTR, "1");
            node.contentWindow.print = print;
          }
        }
      }
    });
    observer.observe(document.body, { childList: true });
    const open = vi.spyOn(window, "open");

    await expect(printHtml(TICKET)).resolves.toBe("printed");
    observer.disconnect();
    expect(print).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    const frame = document.querySelector("iframe");
    expect(frame?.getAttribute("aria-hidden")).toBe("true");
    expect(frame?.srcdoc).toBe(TICKET);
  });

  it("falls back to a popup when the frame can't be used, printing the same document", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const popup = fakePopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);

    // jsdom loads the frame as an empty about:blank document (no `srcdoc`
    // support), which is exactly the "frame isn't the ticket" case.
    await expect(printHtml(TICKET)).resolves.toBe("popup");
    expect(popup.document.write).toHaveBeenCalledWith(TICKET);
    // The unusable frame is cleaned up.
    expect(document.querySelector("iframe")).toBeNull();
    expect(popup.print).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(popup.print).toHaveBeenCalledTimes(1);
  });

  it("reports 'blocked' when the popup is blocked too", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    await expect(printHtml(TICKET)).resolves.toBe("blocked");
  });

  it("enqueuePrint runs prints one after another", async () => {
    const order: string[] = [];
    vi.spyOn(window, "open").mockImplementation(() => {
      order.push("open");
      return null;
    });
    const first = enqueuePrint(TICKET).then((r) => order.push(`first:${r}`));
    const second = enqueuePrint(TICKET).then((r) => order.push(`second:${r}`));
    await Promise.all([first, second]);
    expect(order).toEqual(["open", "first:blocked", "open", "second:blocked"]);
  });
});
