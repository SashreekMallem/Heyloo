import { TICKET_MARKER_ATTR } from "./ticket";

/**
 * Prints a ticket document (LIVE-1). First choice is a hidden same-origin
 * iframe filled via `srcdoc`, which prints without leaving the live screen;
 * if that frame can't be read back or printed, a small popup window is
 * used instead. With desktop Chrome started with `--kiosk-printing` the
 * iframe print goes straight to the default printer with no dialog.
 *
 * Hidden-iframe printing on iPad Safari / Android Chrome is not verified
 * on real devices (docs/VERIFY.md, LIVE-1).
 */
export type PrintOutcome = "printed" | "popup" | "blocked";

const FRAME_LOAD_TIMEOUT_MS = 3_000;
/** The frame is removed on `afterprint`, or after this long at the latest. */
const FRAME_CLEANUP_MS = 60_000;
const POPUP_PRINT_DELAY_MS = 250;

function printViaIframe(html: string): Promise<boolean> {
  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.tabIndex = -1;
    iframe.title = "Order ticket";
    // Rendered but invisible: some browsers print a blank page from a
    // `display: none` frame.
    iframe.style.cssText =
      "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;";

    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (!ok) iframe.remove();
      resolve(ok);
    };
    const timeout = setTimeout(() => finish(false), FRAME_LOAD_TIMEOUT_MS);

    iframe.addEventListener(
      "load",
      () => {
        try {
          const win = iframe.contentWindow;
          if (!win || !iframe.contentDocument?.body?.hasAttribute(TICKET_MARKER_ATTR)) {
            finish(false);
            return;
          }
          const cleanup = () => iframe.remove();
          win.addEventListener("afterprint", cleanup, { once: true });
          setTimeout(cleanup, FRAME_CLEANUP_MS);
          win.focus();
          win.print();
          finish(true);
        } catch {
          finish(false);
        }
      },
      { once: true },
    );

    iframe.srcdoc = html;
    document.body.appendChild(iframe);
  });
}

function printViaPopup(html: string): boolean {
  let popup: Window | null = null;
  try {
    popup = window.open("", "_blank", "popup,width=420,height=640");
  } catch {
    popup = null;
  }
  if (!popup) return false;
  const target = popup;
  target.document.open();
  target.document.write(html);
  target.document.close();
  target.addEventListener("afterprint", () => target.close(), { once: true });
  target.focus();
  setTimeout(() => target.print(), POPUP_PRINT_DELAY_MS);
  return true;
}

export async function printHtml(html: string): Promise<PrintOutcome> {
  if (await printViaIframe(html)) return "printed";
  return printViaPopup(html) ? "popup" : "blocked";
}

let queue: Promise<unknown> = Promise.resolve();

/** Prints one document at a time, so two orders arriving together print as two tickets. */
export function enqueuePrint(html: string): Promise<PrintOutcome> {
  const run = queue.then(() => printHtml(html));
  queue = run.catch(() => undefined);
  return run;
}
