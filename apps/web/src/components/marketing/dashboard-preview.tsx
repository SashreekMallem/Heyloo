"use client";

import {
  CallFeedItem,
  type CallSummary,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataList,
  MetricCard,
  StatusBadge,
} from "@heyloo/ui";

const MOCK_CALLS: CallSummary[] = [
  {
    id: "1",
    callerNumber: "(555) 019-2231",
    classification: "new_booking",
    startedAt: "2026-09-10T15:42:00Z",
    durationSeconds: 214,
  },
  {
    id: "2",
    callerNumber: "(555) 883-4410",
    classification: "question_faq",
    startedAt: "2026-09-10T15:11:00Z",
    durationSeconds: 96,
  },
  {
    id: "3",
    callerNumber: "(555) 227-6690",
    classification: "reschedule",
    startedAt: "2026-09-10T14:30:00Z",
    durationSeconds: 138,
  },
];

/**
 * Dashboard preview section (DESIGN BRIEF: "a dashboard preview section
 * using real UI components") — real `@heyloo/ui` components (`MetricCard`,
 * `CallFeedItem`, `DataList`, `StatusBadge`) laid out as they'd appear on
 * the real tenant overview, seeded with static illustrative data — never a
 * screenshot.
 *
 * `"use client"`: required, not a choice — `CallFeedItem`
 * (packages/ui/src/custom/call-feed-item.tsx) attaches its own `onClick`
 * handler internally without a `"use client"` directive on itself, so any
 * Server Component ancestor that renders it hits React's "Event handlers
 * cannot be passed to Client Component props" prerender error (confirmed:
 * `pnpm build` failed on `/en` until this boundary was added). Logged for
 * the DS cluster in docs/audit/DESIGN_REQUESTS.md rather than fixed here —
 * `packages/ui/**` is out of this cluster's ownership.
 */
export function DashboardPreview() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-3 sm:px-6">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
        </span>
        <p className="ml-2 text-small font-medium text-muted-foreground">Your dashboard</p>
      </div>

      <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-[1.6fr_1fr] lg:gap-6">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <MetricCard label="Calls today" value={14} format="number" delta={12.4} />
            <MetricCard label="Bookings today" value={5} format="number" delta={8.1} />
            <MetricCard label="Minutes used" value={182} format="number" />
            <MetricCard label="Answer rate" value={100} format="percent" />
          </div>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-small font-medium text-muted-foreground">
                Recent calls
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0.5">
              {MOCK_CALLS.map((call) => (
                <CallFeedItem key={call.id} call={call} />
              ))}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader className="flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-small font-medium text-muted-foreground">
              Latest booking
            </CardTitle>
            <StatusBadge variant="booking" value="confirmed" />
          </CardHeader>
          <CardContent>
            <DataList
              layout="inline"
              items={[
                { label: "Customer", value: "M. Alvarez" },
                { label: "Service", value: "Check engine diagnostic" },
                { label: "Vehicle", value: "2019 Honda Civic" },
                { label: "Time", value: "Tomorrow, 10:30 AM", mono: true },
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
