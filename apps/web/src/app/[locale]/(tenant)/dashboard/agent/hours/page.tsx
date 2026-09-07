"use client";

import {
  Button,
  Card,
  CardContent,
  HoursEditor,
  type HoursException,
  type WeeklyHours,
} from "@heyloo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

const EMPTY_DAY = { open: "09:00", close: "17:00", closed: false };
const DEFAULT_HOURS: WeeklyHours = {
  mon: [EMPTY_DAY],
  tue: [EMPTY_DAY],
  wed: [EMPTY_DAY],
  thu: [EMPTY_DAY],
  fri: [EMPTY_DAY],
  sat: [{ ...EMPTY_DAY, closed: true }],
  sun: [{ ...EMPTY_DAY, closed: true }],
};

export default function HoursTabPage() {
  const tenantId = useCurrentTenantId();
  const queryClient = useQueryClient();
  const [hours, setHours] = useState<WeeklyHours>(DEFAULT_HOURS);
  const [exceptions, setExceptions] = useState<HoursException[]>([]);
  const [loaded, setLoaded] = useState(false);

  useQuery({
    queryKey: ["tenant", tenantId, "tenants", "hours"],
    queryFn: async () => {
      const { data } = await supabaseBrowserClient
        .from("tenants")
        .select("business_hours, hours_exceptions")
        .eq("id", tenantId as string)
        .maybeSingle();
      if (data?.business_hours && Object.keys(data.business_hours).length > 0) {
        setHours(data.business_hours as unknown as WeeklyHours);
      }
      setExceptions((data?.hours_exceptions as HoursException[] | undefined) ?? []);
      setLoaded(true);
      return data;
    },
    enabled: !!tenantId,
  });

  async function save() {
    const { error } = await supabaseBrowserClient
      .from("tenants")
      .update({ business_hours: hours, hours_exceptions: exceptions })
      .eq("id", tenantId as string);
    if (error) {
      toast.error("Couldn't save — please try again.");
      return;
    }
    toast.success("Saved — updating your AI, ~30s");
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "tenants"] });
  }

  if (!loaded) return null;

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <HoursEditor
          hours={hours}
          exceptions={exceptions}
          onChange={(nextHours, nextExceptions) => {
            setHours(nextHours);
            setExceptions(nextExceptions);
          }}
        />
        <Button onClick={save}>Save</Button>
      </CardContent>
    </Card>
  );
}
