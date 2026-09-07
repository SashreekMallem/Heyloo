import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AccountStepClient } from "@/components/signup/account-step-client";
import { decodeSignupDraft, SIGNUP_DRAFT_COOKIE } from "@/lib/signup/draft-cookie";

export const metadata: Metadata = { title: "Create your account — Heyloo" };

export default async function SignupAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ annual?: string }>;
}) {
  const cookieStore = await cookies();
  const draft = decodeSignupDraft(cookieStore.get(SIGNUP_DRAFT_COOKIE.name)?.value);
  if (!draft) redirect("/signup");

  const { annual } = await searchParams;
  return (
    <div className="px-4 py-16">
      <AccountStepClient annual={annual === "1"} />
    </div>
  );
}
