import { Button } from "@heyloo/ui";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/marketing/auth-shell";
import { Link } from "@/i18n/navigation";
import { sessionAssuranceFromSupabaseClient } from "@/lib/auth/claims";
import { NO_ACCESS_PATH, roleHome } from "@/lib/auth/role-home";
import { SignOutButton } from "@/lib/auth/sign-out-button";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

const HOME_LABEL: Record<string, string> = {
  "/cockpit": "Go to the admin cockpit",
  "/portal": "Go to your partner portal",
  "/dashboard": "Go to your dashboard",
};

/**
 * `/no-access` (AUTH-05): where a signed-in user lands when the page they
 * asked for needs a role or workspace they don't have. Replaces the old
 * redirect to the marketing home with a toast that vanished after a few
 * seconds and left the visitor looking logged out. Says who they are signed
 * in as, what to do next, and always offers log out.
 */
export default async function NoAccessPage() {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { claims, adminMfaRequired } = await sessionAssuranceFromSupabaseClient(supabase);
  const home = roleHome(claims, { adminMfaRequired });
  const hasHome = home !== NO_ACCESS_PATH;

  return (
    <AuthShell
      title={hasHome ? "That page isn't part of your account" : "Finish setting up your business"}
      description={
        hasHome
          ? "You're signed in, but your account doesn't have access to the page you asked for."
          : "You're signed in, but this account isn't connected to a business yet. That usually means sign-up wasn't finished."
      }
      footer={
        <p>
          Need a hand?{" "}
          <a
            href="mailto:support@heyloo.com"
            className="underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground"
          >
            Contact support
          </a>
        </p>
      }
    >
      <div className="space-y-4">
        <p className="text-center text-small text-muted-foreground">
          Signed in as{" "}
          <span className="font-medium text-foreground">{user.email ?? "your account"}</span>
        </p>
        {hasHome ? (
          <Button asChild size="lg" className="w-full">
            <Link href={home}>{HOME_LABEL[home] ?? "Go to your home page"}</Link>
          </Button>
        ) : (
          <Button asChild size="lg" className="w-full">
            <Link href="/signup/resume">Finish setting up your business</Link>
          </Button>
        )}
        <SignOutButton />
      </div>
    </AuthShell>
  );
}
