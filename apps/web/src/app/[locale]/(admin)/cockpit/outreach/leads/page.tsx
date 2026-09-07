"use client";

import { VERTICALS } from "@heyloo/canonical-types";
import {
  Button,
  DataState,
  LeadTable,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@heyloo/ui";
import { useState } from "react";
import { toast } from "sonner";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

export default function LeadsPage() {
  const [vertical, setVertical] = useState("generic");
  const [source, setSource] = useState<"apollo" | "outscraper" | "apify">("apollo");
  const [triggering, setTriggering] = useState(false);
  const query = useAdminQuery<{ leads: Parameters<typeof LeadTable>[0]["data"] }>(
    "leads",
    [],
    "admin-outreach/leads",
  );

  async function trigger() {
    setTriggering(true);
    const res = await fetch("/api/admin/admin-outreach/leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vertical, source }),
    });
    setTriggering(false);
    if (res.ok) toast.success("Lead fetch job queued");
    else toast.error("Lead fetch isn't available yet.");
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Leads</h1>
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-4">
        <div>
          <label htmlFor="leads-vertical" className="mb-1 block text-xs text-muted-foreground">
            Vertical
          </label>
          <Select value={vertical} onValueChange={setVertical}>
            <SelectTrigger id="leads-vertical" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VERTICALS.map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label htmlFor="leads-source" className="mb-1 block text-xs text-muted-foreground">
            Source
          </label>
          <Select value={source} onValueChange={(v) => setSource(v as typeof source)}>
            <SelectTrigger id="leads-source" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="apollo">Apollo</SelectItem>
              <SelectItem value="outscraper">Outscraper</SelectItem>
              <SelectItem value="apify">Apify</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={trigger} disabled={triggering}>
          Fetch leads
        </Button>
      </div>
      <DataState
        query={query}
        empty={{ title: "No leads yet" }}
        render={(data) => <LeadTable data={data.leads} />}
      />
    </div>
  );
}
