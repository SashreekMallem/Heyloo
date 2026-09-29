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

/**
 * Agent → Manual Mode. SETTINGS-1 found `manual_mode` was sent to the call as
 * `is_manual_mode` but nothing acted on it, and labeled the page honestly.
 * SETTINGS-2: the voice prompt (`{{booking_mode_text}}`, resolved per call in
 * `_shared/agent-settings.ts`) and the text prompt now tell the AI not to book,
 * reschedule or cancel while Manual Mode is on and to take a message instead.
 * It is an instruction to the AI, not a database lock: the tool-level refusal
 * is a separate backend task (VOICE-ALERTS-1), and this page says only what the
 * AI is told.
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
      enabled
        ? "Manual Mode is on — your AI takes messages instead of booking, from the next call."
        : "Manual Mode turned off — your AI books again from the next call.",
    );
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
              While it&apos;s on, your AI is told not to book, reschedule or cancel appointments or
              reservations. It still answers questions, and takes a message with the caller&apos;s
              details so your team can confirm personally. Applies from the next call or text.
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
              From the next call or text your AI stops booking, rescheduling and cancelling and
              takes a message instead, so your team can confirm each request personally. Turn it off
              any time to let your AI book again.
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
