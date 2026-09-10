"use client";

import { formatCentsUSD } from "@heyloo/canonical-types";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "../primitives/button.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../primitives/table.js";
import { EmptyState } from "./empty-error-state.js";

export interface OfferingRowData {
  id: string;
  name: string;
  durationMinutes: number | null;
  priceCents: number | null;
  active: boolean;
}

export interface ServiceOfferingEditorProps {
  offerings: OfferingRowData[];
  onChange: (action: "add" | "edit" | "delete", offering?: OfferingRowData) => void;
}

/** CRUD list of offerings — Agent → Services (FRONTEND_SPEC.md §1.3/§6.6). `onChange` opens the add/edit Dialog at the call site (kept out of this component so the form + `offeringSchema` validation live once, in the page). */
export function ServiceOfferingEditor({ offerings, onChange }: ServiceOfferingEditorProps) {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => onChange("add")}>
          <Plus className="size-3.5" /> Add service
        </Button>
      </div>
      {offerings.length === 0 ? (
        <EmptyState
          title="No services yet"
          description="Add the services your AI can book appointments for."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {offerings.map((offering) => (
              <TableRow key={offering.id}>
                <TableCell className="font-medium">{offering.name}</TableCell>
                <TableCell>
                  {offering.durationMinutes ? `${offering.durationMinutes} min` : "—"}
                </TableCell>
                <TableCell>
                  {offering.priceCents ? formatCentsUSD(offering.priceCents) : "—"}
                </TableCell>
                <TableCell>{offering.active ? "Active" : "Inactive"}</TableCell>
                <TableCell className="flex gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => onChange("edit", offering)}
                    aria-label={`Edit ${offering.name}`}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => onChange("delete", offering)}
                    aria-label={`Delete ${offering.name}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
