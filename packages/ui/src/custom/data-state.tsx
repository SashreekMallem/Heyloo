"use client";

import type { ReactNode } from "react";
import { cn } from "../lib/utils.js";
import { Skeleton } from "../primitives/skeleton.js";
import { EmptyState, ErrorState } from "./empty-error-state.js";

/** The subset of a TanStack Query `UseQueryResult` this wrapper needs — kept structural rather than importing the full generic so callers can pass any query-shaped result (including a hand-rolled polling hook). */
export interface DataStateQueryLike<TData> {
  isPending: boolean;
  isError: boolean;
  error?: unknown;
  data: TData | undefined;
  refetch?: () => void;
}

export interface DataStateProps<TData> {
  query: DataStateQueryLike<TData>;
  empty: {
    title: string;
    description?: string;
    action?: { label: string; onClick: () => void };
    isEmpty?: (data: TData) => boolean;
  };
  render: (data: TData) => ReactNode;
  loadingSkeleton?: ReactNode;
  errorEventId?: string;
  className?: string;
}

function defaultLoadingSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-3/4" />
    </div>
  );
}

/**
 * Renders exactly one of loading/empty/error/success from one query result
 * (FRONTEND_SPEC.md §0.4/§1.3) — no page hand-rolls this branching. Empty
 * and error are visually and textually distinct from each other and from a
 * genuine zero; a failed background action is a non-blocking toast, not
 * this component's concern (that's handled at the mutation call site).
 */
export function DataState<TData>({
  query,
  empty,
  render,
  loadingSkeleton,
  errorEventId,
  className,
}: DataStateProps<TData>) {
  if (query.isPending) {
    return <div className={cn(className)}>{loadingSkeleton ?? defaultLoadingSkeleton()}</div>;
  }
  if (query.isError) {
    return (
      <ErrorState
        className={className}
        eventId={errorEventId}
        onRetry={query.refetch}
        message={query.error instanceof Error ? query.error.message : undefined}
      />
    );
  }
  const data = query.data as TData;
  const isEmpty = empty.isEmpty
    ? empty.isEmpty(data)
    : Array.isArray(data)
      ? data.length === 0
      : data == null;
  if (isEmpty) {
    return (
      <EmptyState
        className={className}
        title={empty.title}
        description={empty.description}
        action={empty.action}
      />
    );
  }
  return <>{render(data)}</>;
}
