import { signupBusinessTypeSchema } from "@heyloo/canonical-types";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { zOptionalBusinessPhone, zOptionalWebsite } from "@/lib/settings/business-contact";
import { encodeSignupDraft, SIGNUP_DRAFT_COOKIE } from "@/lib/signup/draft-cookie";

export const runtime = "nodejs";

/**
 * Step 1's answers plus the optional demo session the visitor came from
 * (always a UUID: it is stored in a signed cookie, so it must be bounded).
 * The business phone and website are re-normalized here (friendly input
 * accepted, blank = not given) — the form's own normalization is only a
 * convenience, never trusted.
 */
const draftRequestSchema = signupBusinessTypeSchema.extend({
  business_phone: zOptionalBusinessPhone,
  website_url: zOptionalWebsite,
  demo_id: z.uuid().optional(),
});

/**
 * Clears the signup draft once the tenant is active (called by the
 * provisioning step when the line is live). Idempotent: deleting a cookie
 * that isn't there is fine, so it needs no session — the cookie is the
 * caller's own and carries nothing sensitive.
 */
export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(SIGNUP_DRAFT_COOKIE.name);
  return NextResponse.json({ ok: true });
}

/** Signup step 1 submit — writes the signed pre-auth draft cookie (FRONTEND_SPEC.md §4.1). */
export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = draftRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const { demo_id: demoId, business_phone: businessPhone, website_url: websiteUrl } = parsed.data;
  const cookieStore = await cookies();
  cookieStore.set(
    SIGNUP_DRAFT_COOKIE.name,
    encodeSignupDraft({
      business_type: parsed.data.business_type,
      business_name: parsed.data.business_name,
      ...(businessPhone ? { business_phone: businessPhone } : {}),
      ...(websiteUrl ? { website_url: websiteUrl } : {}),
      ...(demoId ? { demo_id: demoId } : {}),
    }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SIGNUP_DRAFT_COOKIE.maxAge,
      path: "/",
    },
  );

  return NextResponse.json({ ok: true });
}
