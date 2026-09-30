"use client";

import { Avatar, AvatarFallback, Button } from "@heyloo/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@heyloo/ui/primitives-extra";
import { LogOut } from "lucide-react";
import { useAccountIdentity, useSignOut } from "@/lib/auth/use-account";

function initialsFor(email: string | null): string {
  const local = email?.split("@")[0] ?? "";
  const letters = local.replace(/[^a-z0-9]/gi, "");
  return (letters.slice(0, 2) || "?").toUpperCase();
}

/**
 * Account menu for the tenant, cockpit and partner top bars (QA-1
 * AUTH-02/MAP-04): avatar button -> email, role, Log out. Before this
 * nothing in the product could end a session (the cookie lasts ~400 days).
 */
export function UserMenu({ roleLabel }: { roleLabel?: string }) {
  const { email, roleLabel: role } = useAccountIdentity(roleLabel);
  const signOut = useSignOut();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account menu">
          <Avatar className="size-8">
            <AvatarFallback className="text-xs">{initialsFor(email)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
          <span className="truncate text-sm font-medium">{email ?? "Signed in"}</span>
          {role && <span className="text-xs text-muted-foreground">{role}</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut className="size-4" aria-hidden="true" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The same account info + Log out as a plain block for the sidebar footer —
 * that footer is what the phone navigation drawer shows, where a dropdown
 * inside a modal drawer is awkward. Hidden on `md+` (the top-bar menu
 * covers desktop).
 */
export function SidebarAccount({ roleLabel }: { roleLabel?: string }) {
  const { email, roleLabel: role } = useAccountIdentity(roleLabel);
  const signOut = useSignOut();

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3 md:hidden">
      <div className="min-w-0 px-2">
        <p className="truncate text-sm font-medium">{email ?? "Signed in"}</p>
        {role && <p className="text-xs text-muted-foreground">{role}</p>}
      </div>
      <Button variant="outline" onClick={() => void signOut()}>
        <LogOut aria-hidden="true" />
        Log out
      </Button>
    </div>
  );
}
