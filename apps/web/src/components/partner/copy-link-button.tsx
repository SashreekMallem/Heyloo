"use client";

import { Button } from "@heyloo/ui";
import { Copy } from "lucide-react";
import { toast } from "sonner";

/** Copies exactly the link the page displays (`link` is the absolute referral URL). */
export function CopyLinkButton({ link }: { link: string }) {
  return (
    <Button
      size="icon"
      variant="outline"
      aria-label="Copy your referral link"
      onClick={() => {
        void navigator.clipboard?.writeText(link);
        toast.success("Link copied");
      }}
    >
      <Copy className="size-4" />
    </Button>
  );
}
