"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { performSignOut } from "@/lib/auth/sign-out";

/**
 * Renders the "You don't have access to that page" toast per the §0.2 redirect matrix (wrong role for the route group → `/` with `?toast=no_access`, never a bare 404).
 *
 * That redirect also lands people who are signed in but have no workspace,
 * with nowhere else in the product to go — so the toast carries a Log out
 * action (QA-1 AUTH-02) instead of leaving them stuck in the session.
 */
export function RoleGuardToast() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    if (searchParams.get("toast") === "no_access") {
      toast.error("You don't have access to that page", {
        action: {
          label: "Log out",
          onClick: () => {
            void performSignOut().then((ok) => {
              if (ok) router.push("/login");
              else toast.error("Couldn't log out — please try again.");
            });
          },
        },
      });
    }
  }, [searchParams, router]);

  return null;
}
