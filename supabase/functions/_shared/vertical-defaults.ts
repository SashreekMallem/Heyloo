/**
 * Platform-sensible per-vertical tenant defaults (CALL-1: `docs/BUILD_PLAN.md`
 * task 1, `api-admin-provision-test-tenant`) — business hours, timezone, and
 * a starter set of resources/offerings so `check_availability`/`create_booking`
 * have real data to read/write against immediately after provisioning,
 * exactly the same shape `supabase/seed/seed.sql`'s "one demo tenant per
 * vertical" block already establishes for local dev (`fn_regenerate_availability_slots`
 * needs at least one resource per tenant to have anything to populate).
 * Deliberately duplicated from seed.sql's literal values rather than shared
 * code — seed.sql is pure SQL run by `supabase db reset`/`[db.seed]`, not a
 * module either the Deno edge runtime or this Node-tested handler can
 * import; keeping both in sync by hand is the same tradeoff `_shared/compiler/
 * template-compiler.ts`'s header documents for its own Node/Deno duplication.
 *
 * Portable (no Deno globals) — imported by both `api-admin-provision-test-tenant/
 * handler.ts` (tested under Vitest) and its `index.ts` (Deno at deploy time).
 */

/** Mirrors `packages/canonical-types/src/vertical.ts`'s `VERTICALS` tuple
 * and the `tenants.vertical` check constraint (`supabase/migrations/
 * 20260907130100_tenancy.sql`) — duplicated here rather than imported for
 * the same Node/Deno workspace-package-boundary reason as the rest of this
 * file (see header). Keep in sync by hand if the vertical list ever changes. */
export type Vertical =
  | "auto"
  | "vet"
  | "legal"
  | "dental"
  | "real_estate"
  | "motel"
  | "restaurant"
  | "generic";

export interface VerticalOfferingDefault {
  name: string;
  category?: string;
  duration_minutes?: number;
  price_cents?: number;
  resource_type_required?: string;
}

export interface VerticalResourceDefault {
  type: "chair" | "room" | "table" | "bay" | "staff" | "agent";
  name: string;
  capacity?: number;
  metadata?: Record<string, unknown>;
}

export interface VerticalDefaults {
  business_type: string;
  timezone: string;
  business_hours: Record<string, Array<{ open: string; close: string }>>;
  resources: VerticalResourceDefault[];
  offerings: VerticalOfferingDefault[];
}

const WEEKDAY_9_5: Record<string, Array<{ open: string; close: string }>> = {
  mon: [{ open: "09:00", close: "17:00" }],
  tue: [{ open: "09:00", close: "17:00" }],
  wed: [{ open: "09:00", close: "17:00" }],
  thu: [{ open: "09:00", close: "17:00" }],
  fri: [{ open: "09:00", close: "17:00" }],
  sat: [],
  sun: [],
};

export const VERTICAL_DEFAULTS: Record<Vertical, VerticalDefaults> = {
  auto: {
    business_type: "Auto repair shop",
    timezone: "America/New_York",
    business_hours: {
      mon: [{ open: "08:00", close: "18:00" }],
      tue: [{ open: "08:00", close: "18:00" }],
      wed: [{ open: "08:00", close: "18:00" }],
      thu: [{ open: "08:00", close: "18:00" }],
      fri: [{ open: "08:00", close: "18:00" }],
      sat: [{ open: "09:00", close: "13:00" }],
      sun: [],
    },
    resources: [
      { type: "bay", name: "Bay 1" },
      { type: "bay", name: "Bay 2" },
    ],
    offerings: [
      {
        name: "Oil change",
        category: "maintenance",
        duration_minutes: 30,
        price_cents: 6500,
        resource_type_required: "bay",
      },
      {
        name: "Brake inspection",
        category: "maintenance",
        duration_minutes: 30,
        price_cents: 0,
        resource_type_required: "bay",
      },
      {
        name: "Check engine diagnostic",
        category: "diagnostic",
        duration_minutes: 60,
        price_cents: 12000,
        resource_type_required: "bay",
      },
    ],
  },
  vet: {
    business_type: "Veterinary clinic",
    timezone: "America/Chicago",
    business_hours: {
      mon: [{ open: "08:00", close: "18:00" }],
      tue: [{ open: "08:00", close: "18:00" }],
      wed: [{ open: "08:00", close: "18:00" }],
      thu: [{ open: "08:00", close: "18:00" }],
      fri: [{ open: "08:00", close: "18:00" }],
      sat: [{ open: "09:00", close: "12:00" }],
      sun: [],
    },
    resources: [{ type: "room", name: "Exam Room 1" }],
    offerings: [
      {
        name: "Wellness exam",
        category: "exam",
        duration_minutes: 30,
        price_cents: 6000,
        resource_type_required: "room",
      },
      {
        name: "Vaccination",
        category: "exam",
        duration_minutes: 15,
        price_cents: 4500,
        resource_type_required: "room",
      },
      {
        name: "Sick visit",
        category: "exam",
        duration_minutes: 30,
        price_cents: 7500,
        resource_type_required: "room",
      },
    ],
  },
  legal: {
    business_type: "Personal injury law firm",
    timezone: "America/New_York",
    business_hours: WEEKDAY_9_5,
    resources: [{ type: "staff", name: "Intake Attorney" }],
    offerings: [
      {
        name: "Free consultation",
        category: "consult",
        duration_minutes: 30,
        price_cents: 0,
        resource_type_required: "staff",
      },
      {
        name: "Case review",
        category: "consult",
        duration_minutes: 45,
        price_cents: 0,
        resource_type_required: "staff",
      },
    ],
  },
  dental: {
    business_type: "General dentistry",
    timezone: "America/Los_Angeles",
    business_hours: {
      mon: [{ open: "08:00", close: "17:00" }],
      tue: [{ open: "08:00", close: "17:00" }],
      wed: [{ open: "08:00", close: "17:00" }],
      thu: [{ open: "08:00", close: "17:00" }],
      fri: [{ open: "08:00", close: "14:00" }],
      sat: [],
      sun: [],
    },
    resources: [{ type: "chair", name: "Chair 1", metadata: { slot_minutes: 15 } }],
    offerings: [
      {
        name: "Cleaning",
        category: "hygiene",
        duration_minutes: 30,
        price_cents: 12000,
        resource_type_required: "chair",
      },
      {
        name: "Checkup + X-ray",
        category: "exam",
        duration_minutes: 45,
        price_cents: 18000,
        resource_type_required: "chair",
      },
      {
        name: "Filling",
        category: "restorative",
        duration_minutes: 60,
        price_cents: 25000,
        resource_type_required: "chair",
      },
    ],
  },
  real_estate: {
    business_type: "Residential brokerage",
    timezone: "America/Denver",
    business_hours: {
      mon: [{ open: "09:00", close: "18:00" }],
      tue: [{ open: "09:00", close: "18:00" }],
      wed: [{ open: "09:00", close: "18:00" }],
      thu: [{ open: "09:00", close: "18:00" }],
      fri: [{ open: "09:00", close: "18:00" }],
      sat: [{ open: "10:00", close: "15:00" }],
      sun: [],
    },
    resources: [{ type: "staff", name: "Showing Agent" }],
    offerings: [
      {
        name: "Property showing",
        category: "showing",
        duration_minutes: 30,
        price_cents: 0,
        resource_type_required: "staff",
      },
      {
        name: "Buyer consultation",
        category: "consult",
        duration_minutes: 45,
        price_cents: 0,
        resource_type_required: "staff",
      },
    ],
  },
  motel: {
    business_type: "Roadside motel",
    timezone: "America/Chicago",
    business_hours: {
      mon: [{ open: "00:00", close: "23:59" }],
      tue: [{ open: "00:00", close: "23:59" }],
      wed: [{ open: "00:00", close: "23:59" }],
      thu: [{ open: "00:00", close: "23:59" }],
      fri: [{ open: "00:00", close: "23:59" }],
      sat: [{ open: "00:00", close: "23:59" }],
      sun: [{ open: "00:00", close: "23:59" }],
    },
    resources: [
      { type: "room", name: "Room 101" },
      { type: "room", name: "Room 102" },
    ],
    offerings: [
      {
        name: "Standard queen room",
        category: "room",
        price_cents: 8900,
        resource_type_required: "room",
      },
      {
        name: "Double queen room",
        category: "room",
        price_cents: 10900,
        resource_type_required: "room",
      },
    ],
  },
  restaurant: {
    business_type: "Restaurant",
    timezone: "America/New_York",
    business_hours: {
      mon: [],
      tue: [{ open: "11:00", close: "21:00" }],
      wed: [{ open: "11:00", close: "21:00" }],
      thu: [{ open: "11:00", close: "21:00" }],
      fri: [{ open: "11:00", close: "22:00" }],
      sat: [{ open: "11:00", close: "22:00" }],
      sun: [{ open: "12:00", close: "20:00" }],
    },
    resources: [{ type: "table", name: "Table 1", capacity: 4 }],
    offerings: [
      { name: "Margherita pizza", category: "entree", price_cents: 1600 },
      { name: "Spaghetti carbonara", category: "entree", price_cents: 1800 },
      { name: "Tiramisu", category: "dessert", price_cents: 900 },
    ],
  },
  generic: {
    business_type: "General service business",
    timezone: "America/New_York",
    business_hours: WEEKDAY_9_5,
    resources: [{ type: "staff", name: "Front Desk" }],
    offerings: [
      {
        name: "General appointment",
        category: "general",
        duration_minutes: 30,
        price_cents: 0,
        resource_type_required: "staff",
      },
    ],
  },
};
