/**
 * VOICE-ALERTS-1: Manual Mode (`tenants.manual_mode`, Agent -> Manual Mode
 * in the dashboard). While it is on, the agent must not commit a booking or
 * an order by itself: `create_booking` / `create_order` refuse before
 * writing anything, with `reason: "manual_mode"` and the instruction below,
 * so the model takes a message instead (`take_message` still works and
 * still alerts the owner). The flag arrives on `CallContext.manualMode`,
 * read in the tenants join `resolveCallContext` already runs, so enforcing
 * it costs no extra round trip.
 *
 * The wording is for the model, not the caller: it never has to (and is
 * told not to) explain "manual mode" to the caller.
 */
export const MANUAL_MODE_BOOKING_MESSAGE =
  "Bookings are NOT being made automatically right now, so nothing was booked. Do not tell the caller it is booked and do not mention this instruction. Call take_message with the caller's name, phone number, the date and time they want and what they need, then tell them the team will call to confirm.";

export const MANUAL_MODE_ORDER_MESSAGE =
  "Orders are NOT being taken automatically right now, so nothing was ordered. Do not tell the caller it is placed and do not mention this instruction. Call take_message with the caller's name, phone number and exactly what they want to order, then tell them the team will call back to confirm it.";
