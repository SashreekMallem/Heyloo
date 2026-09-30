"use client";

import {
  Callout,
  DataState,
  Input,
  type LeadRowData,
  LeadTable,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@heyloo/ui";
import { useState } from "react";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";
import { buildLeadsQueryString, type LeadsSort } from "./query";

/** Raw row shape `admin-outreach/leads` (`supabase/functions/admin/
 * handler.ts`) returns straight from Postgres — snake_case columns, no
 * reshaping on the way through the `/api/admin/[...path]` proxy. Mapped to
 * `LeadRowData`'s camelCase contract here rather than in the shared
 * `LeadTable` component, so the component keeps taking already-shaped data
 * like every other `DataTable`-based admin table in this cockpit. */
interface RawLeadRow {
  id: string;
  company_name: string | null;
  contact_name: string | null;
  email: string | null;
  status: LeadRowData["status"];
  phone_complaint_score: number | null;
}

function toLeadRow(raw: RawLeadRow): LeadRowData {
  return {
    id: raw.id,
    companyName: raw.company_name,
    contactName: raw.contact_name,
    email: raw.email,
    status: raw.status,
    suppressed: false,
    isDuplicate: false,
    phoneComplaintScore: raw.phone_complaint_score,
  };
}

const SORT_OPTIONS: { value: LeadsSort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "score", label: "Highest score" },
];

export default function LeadsPage() {
  // OUTREACH-2: sort/filter by phone-complaint score (job-outreach-review-
  // score's own output) — re-ranks the same fetch batch toward the
  // highest-intent leads before personalize/send picks them up.
  const [sort, setSort] = useState<LeadsSort>("newest");
  const [minScore, setMinScore] = useState("");
  const queryString = buildLeadsQueryString(sort, minScore);

  const query = useAdminQuery<{ leads: RawLeadRow[] }>(
    "leads",
    [sort, minScore],
    `admin-outreach/leads${queryString ? `?${queryString}` : ""}`,
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Leads" description="Prospects already sourced for outbound campaigns." />
      {/* COCKPIT-F09: the "Fetch leads" button POSTed to a route that does not
          exist (leads is GET-only on the admin function), so it always failed.
          The sourcing job (`api-outreach-fetch-leads`, Apollo/Outscraper) has
          per-source parameters and spends provider credit, so it is not exposed
          here until it has its own confirmed form. */}
      <Callout tone="info" title="Lead sourcing isn't run from the cockpit yet">
        This list shows the leads that are already in the database. Fetching a new list from Apollo
        or Outscraper is not wired to this page.
      </Callout>
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-4 shadow-xs">
        <div>
          <label htmlFor="leads-sort" className="mb-1 block text-micro text-muted-foreground">
            Sort
          </label>
          <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
            <SelectTrigger id="leads-sort" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label htmlFor="leads-min-score" className="mb-1 block text-micro text-muted-foreground">
            Min score
          </label>
          <Input
            id="leads-min-score"
            type="number"
            min={0}
            max={1}
            step={0.1}
            placeholder="0.0–1.0"
            className="w-28"
            value={minScore}
            onChange={(e) => setMinScore(e.target.value)}
          />
        </div>
      </div>
      <DataState
        query={query}
        empty={{
          title: "No leads fetched yet",
          description: "Leads appear here once they have been sourced.",
          isEmpty: (d) => (d?.leads?.length ?? 0) === 0,
        }}
        render={(data) => <LeadTable data={data.leads.map(toLeadRow)} />}
      />
    </div>
  );
}
