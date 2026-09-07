"use client";

import { ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../primitives/button.js";

export interface ImpersonationBannerProps {
  tenantName: string;
  adminEmail: string;
  expiresAt: string;
  editMode: boolean;
  onEnd: () => void;
}

function remaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Red persistent bar during admin impersonation, countdown visible (FRONTEND_SPEC.md §1.3/§7.2). */
export function ImpersonationBanner({
  tenantName,
  adminEmail,
  expiresAt,
  editMode,
  onEnd,
}: ImpersonationBannerProps) {
  const [countdown, setCountdown] = useState(() => remaining(expiresAt));

  useEffect(() => {
    const id = setInterval(() => setCountdown(remaining(expiresAt)), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 bg-destructive px-4 py-2 text-sm text-destructive-foreground">
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-4" />
        <span>
          Viewing <strong className="font-semibold">{tenantName}</strong> as {adminEmail} —{" "}
          {editMode ? "edits enabled" : "read-only"} — {countdown} remaining
        </span>
      </div>
      <Button size="sm" variant="secondary" onClick={onEnd}>
        End impersonation
      </Button>
    </div>
  );
}
