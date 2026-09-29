/**
 * MSG-3: what the owner portal says after an action that would text a
 * customer. Owner decision: phone numbers are Retell-provided and there is no
 * texting provider at launch, so until carriers approve a business's texting
 * number (`tenants.a2p_status = 'verified'`) NOTHING is texted, and the portal
 * must not claim it was. Pure, so every wording is unit-tested.
 */

/** Toast after a booking is confirmed, cancelled or rescheduled from the portal. */
export function customerNotifiedToast(input: { textingOn: boolean; smsQueued: boolean }): string {
  if (!input.textingOn) {
    return "Saved. Texting is off until it's set up, so the customer wasn't texted.";
  }
  return input.smsQueued ? "Customer notified by SMS" : "Saved — SMS notification pending";
}

/** Toast after "Resend payment link". */
export function paymentLinkResentToast(input: { textingOn: boolean }): string {
  return input.textingOn
    ? "Payment link re-sent by SMS"
    : "Texting is off until it's set up, so the link wasn't texted. Check your email for a copy to pass on.";
}
