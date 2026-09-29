/**
 * Split out of `page.tsx` (a Next.js page file may only export a fixed
 * allow-list of names). Turns a failed `POST admin-outreach/campaigns` into
 * something the admin can act on (COCKPIT-F08): the page used to blame a
 * "backend endpoint pending" for every status.
 */
export interface CampaignFieldError {
  field: "name" | "vertical" | "sending_domain" | "daily_send_cap" | "template_id";
  message: string;
}

export interface CampaignCreateFailure {
  message: string;
  fieldErrors: CampaignFieldError[];
}

const FIELDS: readonly CampaignFieldError["field"][] = [
  "name",
  "vertical",
  "sending_domain",
  "daily_send_cap",
  "template_id",
];

interface ErrorBody {
  error?: unknown;
  issues?: { path?: unknown[]; message?: unknown }[];
}

export function describeCampaignCreateFailure(
  status: number,
  body: unknown,
): CampaignCreateFailure {
  const { error, issues } = (body && typeof body === "object" ? body : {}) as ErrorBody;

  if (status === 501) {
    return {
      message:
        "Smartlead isn't configured for this deployment (SMARTLEAD_API_KEY and OUTREACH_CAN_SPAM_FOOTER), so no campaign was created.",
      fieldErrors: [],
    };
  }
  if (status === 422) {
    if (error === "unsupported_provider") {
      return { message: "Only Smartlead campaigns can be created.", fieldErrors: [] };
    }
    const fieldErrors: CampaignFieldError[] = [];
    for (const issue of issues ?? []) {
      const field = issue.path?.[0];
      if (typeof field === "string" && typeof issue.message === "string") {
        const known = FIELDS.find((f) => f === field);
        if (known) fieldErrors.push({ field: known, message: issue.message });
      }
    }
    return { message: "Check the highlighted fields.", fieldErrors };
  }
  if (status === 502) {
    return {
      message: "Smartlead rejected the campaign, so nothing was created. Try again in a minute.",
      fieldErrors: [],
    };
  }
  if (status === 403) {
    return {
      message: "Only a signed-in platform admin with MFA can create campaigns.",
      fieldErrors: [],
    };
  }
  return {
    message: `Couldn't create the campaign (HTTP ${status}). Please try again.`,
    fieldErrors: [],
  };
}
