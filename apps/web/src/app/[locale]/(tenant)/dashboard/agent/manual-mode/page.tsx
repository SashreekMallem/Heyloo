"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Callout,
  Card,
  CardContent,
  ManualModeBanner,
  Switch,
} from "@heyloo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

/**
 * Agent → Manual Mode. SETTINGS-1: the settings audit found `manual_mode`
 * is sent to the call as `is_manual_mode` but no prompt, voice tool or text
 * reply checks it — the AI keeps confirming bookings. The page used to
 * promise the opposite; it now says plainly that the switch is saved but
 * not enforced yet (backend follow-up in docs/BUILD_NOTES.md SETTINGS-1).
 */
export default function ManualModeTabPage() {
  const tenantId = useCurrentTenantId();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const query = useQuery({
    queryKey: ["tenant", tenantId, "tenants", "manual_mode"],
    queryFn: async () => {
      const { data } = await supabaseBrowserClient
        .from("tenants")
        .select("manual_mode, manual_mode_enabled_at")
        .eq("id", tenantId as string)
        .maybeSingle();
      return data;
    },
    enabled: !!tenantId,
  });

  async function setManualMode(enabled: boolean) {
    const { error } = await supabaseBrowserClient
      .from("tenants")
      .update({
        manual_mode: enabled,
        manual_mode_enabled_at: enabled ? new Date().toISOString() : null,
      })
      .eq("id", tenantId as string);
    if (error) {
      toast.error("Couldn't save — please try again.");
      return;
    }
    toast.success(
      enabled ? "Saved — Manual Mode isn't enforced yet (see the note)." : "Manual Mode turned off",
    );
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "tenants"] });
  }

  const enabled = query.data?.manual_mode ?? false;

  return (
    <div className="space-y-4">
      <Callout tone="warning" title="Not active yet">
        Turning Manual Mode on today does <strong>not</strong> stop your AI from confirming bookings
        and orders. Your choice is saved and takes effect automatically once Manual Mode ships.
        Until then, to stop bookings, mark your days closed on the Hours tab.
      </Callout>
      {enabled && query.data?.manual_mode_enabled_at && (
        <ManualModeBanner
          since={query.data.manual_mode_enabled_at}
          onDisable={() => void setManualMode(false)}
        />
      )}
      <Card>
        <CardContent className="flex items-center justify-between pt-6">
          <div>
            <p className="font-medium">Manual Mode</p>
            <p className="text-sm text-muted-foreground">
              When it&apos;s available: your AI takes booking and order requests without confirming
              them, and sends them to you to confirm.
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => {
              if (checked) setConfirmOpen(true);
              else void setManualMode(false);
            }}
            aria-label="Manual Mode"
          />
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn on Manual Mode?</AlertDialogTitle>
            <AlertDialogDescription>
              Manual Mode isn&apos;t enforced yet — your AI will keep confirming bookings for now.
              Your choice is saved and applies automatically once Manual Mode ships.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void setManualMode(true);
                setConfirmOpen(false);
              }}
            >
              Turn on Manual Mode
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
