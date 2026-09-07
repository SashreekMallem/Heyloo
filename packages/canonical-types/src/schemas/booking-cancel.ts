import { z } from "zod";

export const bookingCancelSchema = z.object({
  booking_id: z.string().min(1),
  reason: z.string().max(500).optional(),
});

export type BookingCancel = z.infer<typeof bookingCancelSchema>;
