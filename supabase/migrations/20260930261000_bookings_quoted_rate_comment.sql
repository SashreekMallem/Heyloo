-- BEHAVIOR-voice-agent (F-OFFERING-1): documentation-only. `create_booking` now writes the
-- matched offering's own `offerings.price_cents` into `quoted_rate_cents` for every vertical
-- when the booking is written against an offering (the model's `offering_id`, or the one active
-- offering whose name equals the visit reason it gave), where before only a motel's quoted nightly
-- rate reached this column. No schema change: the column already exists
-- (20260910120500_bookings_quoted_rate_and_hold_expiry.sql) and stays nullable.
comment on column public.bookings.quoted_rate_cents is
  'The price quoted for this booking, in integer cents. Motel: the nightly rate the agent quoted from the rate table (structured_payload.quoted_rate_cents). Every other vertical: offerings.price_cents of the booked offering when the offering has a price (BEHAVIOR-voice-agent, F-OFFERING-1). Null when no offering or no rate applies.';
