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
  /** Hides Add/Edit/Delete — a team member can view the list but not change it (QA-1 F-5). */
  readOnly?: boolean;
}

function EditDeleteButtons({
  offering,
  onChange,
}: {
  offering: OfferingRowData;
  onChange: ServiceOfferingEditorProps["onChange"];
}) {
  return (
    <>
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
    </>
  );
}

/**
 * CRUD list of offerings — Agent → Services (FRONTEND_SPEC.md §1.3/§6.6). `onChange` opens the add/edit Dialog at the call site (kept out of this component so the form + `offeringSchema` validation live once, in the page).
 *
 * QA-1 F-11: below `md` the list is a stack of cards (name + price/length, then the Edit/Delete row) — the table was wider than a phone with the buttons scrolled off-screen. QA-1 MAP-15: the actions column header has a screen-reader label.
 */
export function ServiceOfferingEditor({
  offerings,
  onChange,
  readOnly = false,
}: ServiceOfferingEditorProps) {
  return (
    <div className="space-y-3">
      {!readOnly && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => onChange("add")}>
            <Plus className="size-3.5" /> Add service
          </Button>
        </div>
      )}
      {offerings.length === 0 ? (
        <EmptyState
          title="No services yet"
          description={
            readOnly
              ? "Your account owner or an admin can add the services your AI books."
              : "Add the services your AI can book appointments for."
          }
        />
      ) : (
        <>
          <ul className="flex flex-col gap-2 md:hidden" data-testid="service-cards">
            {offerings.map((offering) => (
              <li key={offering.id} className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{offering.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {offering.durationMinutes ? `${offering.durationMinutes} min` : "No length"}
                      {offering.active ? "" : " · Inactive"}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm tabular-nums">
                    {offering.priceCents ? formatCentsUSD(offering.priceCents) : "—"}
                  </p>
                </div>
                {!readOnly && (
                  <div className="mt-2 flex justify-end gap-1 border-t border-border pt-2">
                    <EditDeleteButtons offering={offering} onChange={onChange} />
                  </div>
                )}
              </li>
            ))}
          </ul>

          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
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
                      {!readOnly && <EditDeleteButtons offering={offering} onChange={onChange} />}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
