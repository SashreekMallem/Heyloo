"use client";

import { Button } from "@heyloo/ui";
import { useState } from "react";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * Signs the visitor out and returns them to the login page. A full page load
 * (not a client-side push) so the server sees the cleared cookies and no
 * cached role-guarded page is shown.
 */
export function SignOutButton({ variant = "outline" }: { variant?: "outline" | "ghost" }) {
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    await supabaseBrowserClient.auth.signOut();
    window.location.assign("/login");
  }

  return (
    <Button
      type="button"
      variant={variant}
      size="lg"
      className="w-full"
      onClick={onClick}
      loading={pending}
    >
      Log out
    </Button>
  );
}
