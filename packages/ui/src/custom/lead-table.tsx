import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "../primitives/badge.js";
import { DataTable, type DataTableProps } from "./data-table.js";

export interface LeadRowData {
  id: string;
  companyName: string | null;
  contactName: string | null;
  email: string | null;
  status: "new" | "queued" | "sent" | "replied" | "suppressed" | "converted";
  suppressed: boolean;
  isDuplicate: boolean;
  /** OUTREACH-2: 0-1 phone-complaint confidence from `job-outreach-review-
   * score`, or null/undefined when the lead has no Google place id or
   * hasn't been analyzed yet. */
  phoneComplaintScore?: number | null;
}

export const leadTableColumns: ColumnDef<LeadRowData, unknown>[] = [
  {
    accessorKey: "companyName",
    header: "Company",
    cell: ({ row }) => row.original.companyName ?? "—",
  },
  {
    accessorKey: "contactName",
    header: "Contact",
    cell: ({ row }) => row.original.contactName ?? "—",
  },
  { accessorKey: "email", header: "Email", cell: ({ row }) => row.original.email ?? "—" },
  {
    accessorKey: "phoneComplaintScore",
    header: "Score",
    cell: ({ row }) => {
      const score = row.original.phoneComplaintScore;
      if (score === null || score === undefined) return "—";
      return (
        <Badge variant={score >= 0.6 ? "warning" : "outline"}>{Math.round(score * 100)}%</Badge>
      );
    },
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <Badge variant="outline">{row.original.status}</Badge>,
  },
  {
    id: "dedupe",
    header: "Dedupe",
    cell: ({ row }) =>
      row.original.suppressed ? (
        <Badge variant="destructive">Suppressed</Badge>
      ) : row.original.isDuplicate ? (
        <Badge variant="warning">Duplicate</Badge>
      ) : (
        <Badge variant="success">Clean</Badge>
      ),
  },
];

/** Leads with dedupe/suppression status — outreach leads (FRONTEND_SPEC.md §1.3/§7.3). Extends `DataTable`. */
export function LeadTable(props: Omit<DataTableProps<LeadRowData>, "columns">) {
  return <DataTable<LeadRowData> columns={leadTableColumns} {...props} />;
}
