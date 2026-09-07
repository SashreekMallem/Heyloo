import { z } from "zod";

const zDayHours = z.object({
  open: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM 24h time"),
  close: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM 24h time"),
  closed: z.boolean().default(false),
});

const zHoursException = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  closed: z.boolean().optional(),
  open: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  close: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  note: z.string().max(200).optional(),
});

/** Agent → Hours (FRONTEND_SPEC.md §6.6). Weekly hours (Mon-Sun) + holiday exceptions. */
export const businessHoursSchema = z.object({
  hours: z.object({
    mon: z.array(zDayHours),
    tue: z.array(zDayHours),
    wed: z.array(zDayHours),
    thu: z.array(zDayHours),
    fri: z.array(zDayHours),
    sat: z.array(zDayHours),
    sun: z.array(zDayHours),
  }),
  exceptions: z.array(zHoursException),
});

export type BusinessHours = z.infer<typeof businessHoursSchema>;
