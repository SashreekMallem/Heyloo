import { formatPhoneDisplay } from "./format";
import { countOpenDays } from "./hours";
import { PUBLISH_REASON_TEXT, type PublishStatus } from "./publish-status";

/**
 * SETTINGS-1: the agent Overview's "Settings checklist" — which key
 * settings are still empty. Pure (the route does the reads), so every rule
 * here is unit-tested without a database.
 */

export type ChecklistItemId =
  | "transfer_number"
  | "business_hours"
  | "services"
  | "resources"
  | "notification_recipients"
  | "published"
  | "owner_test_phone";

export interface ChecklistItem {
  id: ChecklistItemId;
  label: string;
  done: boolean;
  detail: string;
  href: string;
  optional: boolean;
}

export interface ChecklistInput {
  vertical: string;
  transferNumber: string | null;
  businessHours: unknown;
  activeOfferings: number;
  activeResources: number;
  delivery: unknown;
  ownerTestPhone: string | null;
  publish: PublishStatus;
}

const RESOURCE_NOUN: Record<string, string> = {
  auto: "service bays",
  vet: "exam rooms",
  motel: "rooms",
  restaurant: "tables",
  dental: "chairs",
};

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function recipientsFrom(delivery: unknown): { phone: string | null; email: string | null } {
  if (typeof delivery !== "object" || delivery === null) return { phone: null, email: null };
  const record = delivery as Record<string, unknown>;
  return {
    phone: nonEmpty(record["alert_phone"]) ? record["alert_phone"] : null,
    email: nonEmpty(record["notification_email"]) ? record["notification_email"] : null,
  };
}

function recipientsDetail(recipients: { phone: string | null; email: string | null }): string {
  const parts = [
    recipients.phone ? `texts to ${formatPhoneDisplay(recipients.phone)}` : null,
    recipients.email ? `email to ${recipients.email}` : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) {
    return "Not set — choose the phone and email that get new-message and booking alerts.";
  }
  const sentence = parts.join(", ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

export function computeSettingsChecklist(input: ChecklistInput): ChecklistItem[] {
  const openDays = countOpenDays(input.businessHours);
  const recipients = recipientsFrom(input.delivery);
  const resourceNoun = RESOURCE_NOUN[input.vertical] ?? "staff members";

  return [
    {
      id: "transfer_number",
      label: "Transfer number",
      done: nonEmpty(input.transferNumber),
      detail: nonEmpty(input.transferNumber)
        ? `Callers who ask for a person are put through to ${formatPhoneDisplay(input.transferNumber)}.`
        : "Not set — callers who ask for a person can't be put through.",
      href: "/dashboard/agent/instructions",
      optional: false,
    },
    {
      id: "business_hours",
      label: "Business hours",
      done: openDays > 0,
      detail:
        openDays > 0
          ? `Open ${openDays} day${openDays === 1 ? "" : "s"} a week.`
          : "Not set — every day is closed, so your AI can't offer any times.",
      href: "/dashboard/agent/hours",
      optional: false,
    },
    {
      id: "services",
      label: "Services",
      done: input.activeOfferings > 0,
      detail:
        input.activeOfferings > 0
          ? `${input.activeOfferings} active service${input.activeOfferings === 1 ? "" : "s"}.`
          : "None yet — your AI can only book or sell what's listed here.",
      href: "/dashboard/agent/services",
      optional: false,
    },
    {
      id: "resources",
      label: `Bookable ${resourceNoun}`,
      done: input.activeResources > 0,
      detail:
        input.activeResources > 0
          ? `${input.activeResources} active — each gets its own bookable times.`
          : `None yet — add at least one so there are times to book.`,
      href: "/dashboard/setup/resources",
      optional: false,
    },
    {
      id: "notification_recipients",
      label: "Who gets alerts",
      done: recipients.phone !== null || recipients.email !== null,
      detail: recipientsDetail(recipients),
      href: "/dashboard/delivery",
      optional: false,
    },
    {
      id: "published",
      label: "Agent published and up to date",
      done: !input.publish.pending,
      detail: input.publish.pending
        ? input.publish.reasons.map((reason) => PUBLISH_REASON_TEXT[reason]).join(" ")
        : "Your live agent has every change that needs publishing.",
      href: "/dashboard/agent",
      optional: false,
    },
    {
      id: "owner_test_phone",
      label: "Your test phone",
      done: nonEmpty(input.ownerTestPhone),
      detail: nonEmpty(input.ownerTestPhone)
        ? `Calls from ${formatPhoneDisplay(input.ownerTestPhone)} are marked as tests and not billed.`
        : "Optional — add your cell so your own test calls aren't billed.",
      href: "/dashboard/test-agent",
      optional: true,
    },
  ];
}
