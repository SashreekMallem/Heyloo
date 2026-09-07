"use client";

import { Button } from "@heyloo/ui";
import { Copy } from "lucide-react";
import { toast } from "sonner";

export function CopyLinkButton({ code }: { code: string }) {
  return (
    <Button
      size="icon"
      variant="outline"
      onClick={() => {
        void navigator.clipboard?.writeText(`${window.location.origin}/signup?ref=${code}`);
        toast.success("Link copied");
      }}
    >
      <Copy className="size-4" />
    </Button>
  );
}
