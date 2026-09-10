"use client";

import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { cn } from "../lib/utils.js";
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

export interface DataTableFilter {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
}

export interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  pageCount?: number;
  pageIndex?: number;
  onPageChange?: (pageIndex: number) => void;
  filters?: DataTableFilter[];
  onRowClick?: (row: TData) => void;
  emptyState?: {
    title: string;
    description?: string;
    action?: { label: string; onClick: () => void };
  };
  /** Mobile card-collapse renderer — required to satisfy FRONTEND_SPEC.md §0.5 ("rows collapse to stacked cards below sm"); omit only for tables already card-shaped. */
  renderMobileCard?: (row: TData) => ReactNode;
  className?: string;
}

/** Generic table on @tanstack/react-table: sort, column filters, server-side pagination, row click, mobile card-collapse (FRONTEND_SPEC.md §1.3). Used by calls/bookings/customers/tenants/outreach leads-replies/alert-rules. */
export function DataTable<TData>({
  columns,
  data = [],
  pageCount,
  pageIndex = 0,
  onPageChange,
  filters,
  onRowClick,
  emptyState,
  renderMobileCard,
  className,
}: DataTableProps<TData>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: pageCount ?? -1,
  });

  if (data.length === 0 && emptyState) {
    return <EmptyState {...emptyState} />;
  }

  return (
    <div className={cn("space-y-3", className)}>
      {filters && filters.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {filters.map((filter) => (
            <select
              key={filter.label}
              aria-label={filter.label}
              value={filter.value}
              onChange={(e) => filter.onChange(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              {filter.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ))}
        </div>
      )}

      {renderMobileCard && (
        <div className="flex flex-col gap-2 lg:hidden">
          {table.getRowModel().rows.map((row) =>
            onRowClick ? (
              <button
                key={row.id}
                type="button"
                className="w-full text-left"
                onClick={() => onRowClick(row.original)}
              >
                {renderMobileCard(row.original)}
              </button>
            ) : (
              <div key={row.id}>{renderMobileCard(row.original)}</div>
            ),
          )}
        </div>
      )}

      <div className={cn("overflow-x-auto", renderMobileCard ? "hidden lg:block" : undefined)}>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                onClick={() => onRowClick?.(row.original)}
                className={onRowClick ? "cursor-pointer" : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {pageCount !== undefined && pageCount > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={pageIndex <= 0}
            onClick={() => onPageChange?.(pageIndex - 1)}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {pageIndex + 1} of {pageCount}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={pageIndex >= pageCount - 1}
            onClick={() => onPageChange?.(pageIndex + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
