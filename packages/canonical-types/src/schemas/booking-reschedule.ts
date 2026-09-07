import { z } from "zod";

export const bookingRescheduleSchema = z.object({
  booking_id: z.string().min(1),
  new_slot_id: z.string().min(1),
});

export type BookingReschedule = z.infer<typeof bookingRescheduleSchema>;
