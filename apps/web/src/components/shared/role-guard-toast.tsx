"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

/** Renders the "You don't have access to that page" toast per the §0.2 redirect matrix (wrong role for the route group → `/` with `?toast=no_access`, never a bare 404). */
export function RoleGuardToast() {
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get("toast") === "no_access") {
      toast.error("You don't have access to that page");
    }
  }, [searchParams]);

  return null;
}
