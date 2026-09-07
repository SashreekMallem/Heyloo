import { signupBusinessTypeSchema } from "@heyloo/canonical-types";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { encodeSignupDraft, SIGNUP_DRAFT_COOKIE } from "@/lib/signup/draft-cookie";

export const runtime = "nodejs";

/** Signup step 1 submit — writes the signed pre-auth draft cookie (FRONTEND_SPEC.md §4.1). */
export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = signupBusinessTypeSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const demoId = (json as { demo_id?: unknown }).demo_id;
  const cookieStore = await cookies();
  cookieStore.set(
    SIGNUP_DRAFT_COOKIE.name,
    encodeSignupDraft({
      business_type: parsed.data.business_type,
      business_name: parsed.data.business_name,
      ...(typeof demoId === "string" ? { demo_id: demoId } : {}),
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
