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
    toast.success(enabled ? "Manual Mode turned on" : "Manual Mode turned off");
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "tenants"] });
  }

  const enabled = query.data?.manual_mode ?? false;

  return (
    <div className="space-y-4">
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
              Stops the AI from confirming bookings automatically — new orders/bookings are sent to
              you by SMS instead.
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
              Turning on Manual Mode stops the AI from confirming bookings automatically — new
              orders/bookings will be sent to you by SMS instead.
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
