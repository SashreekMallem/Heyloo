export type StartCheckoutResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Creates the Stripe Checkout Session for the signed-in customer through our
 * own Route Handler (`/api/checkout/session`, which derives vertical, business
 * name and email server-side — nothing identity-bearing is sent from here).
 * Shared by the account step (a fresh signup with a session) and the signup
 * resume step (a customer returning from the confirmation email or from a
 * cancelled Checkout).
 */
export async function startCheckout(
  input: { annual: boolean; whiteGlove: boolean },
  fetchImpl: typeof fetch = fetch,
): Promise<StartCheckoutResult> {
  try {
    const res = await fetchImpl("/api/checkout/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        annual: input.annual,
        white_glove: input.whiteGlove,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (res.ok && body.url) return { ok: true, url: body.url };
    return { ok: false, error: body.error ?? "checkout_failed" };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

/** Customer-facing wording for the error codes `/api/checkout/session` returns. */
export function checkoutErrorMessage(code: string): string {
  switch (code) {
    case "unauthenticated":
      return "Your session has expired. Please log in again to continue to payment.";
    case "missing_draft":
      return "We lost track of your business details. Please start again.";
    case "network_error":
      return "We couldn't reach the payment step. Check your connection and try again.";
    case "stripe_not_configured":
      return "Payments aren't available yet. Please contact support.";
    default:
      return "We couldn't start the payment step. Please try again.";
  }
}
