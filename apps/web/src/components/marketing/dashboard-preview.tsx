"use client";

import {
  CallFeedItem,
  type CallSummary,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  DataList,
  ENTRANCE_STAGGER_MS,
  MetricCard,
  MOTION_DURATIONS_MS,
  StatusBadge,
} from "@heyloo/ui";
import { Reveal } from "@/components/marketing/reveal";
import { useCountUp } from "@/lib/marketing/use-count-up";
import { useInView } from "@/lib/marketing/use-in-view";

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
 * Motion — this is set piece #2 (DESIGN BRIEF §2, "Dashboard reveal"): the
 * panel enters as a slightly receded, tilted card (`rotateX(6deg)
 * translateZ(-40px)`, a CSS 3D transform — no WebGL) and settles flat as
 * it reaches ~35% into the viewport; the tilt is scoped to `sm:` and up
 * (mobile gets the flat panel, per the brief) via a Tailwind responsive
 * arbitrary-property class rather than a JS width check, so it degrades
 * for free at the same breakpoint the rest of the page uses. Once
 * settled, the four `MetricCard`s count up 0 → their real display value
 * once (never scrubbed — a reversing counter reads as a bug), and the
 * "Recent calls" rows stagger in 50ms apart. The top row is real product
 * markup (`CallFeedItem`), matching the hero's final booking-card frame
 * so a visitor who scrolled straight down recognizes "the same booking,
 * now living here."
 *
 * `"use client"`: required regardless of the motion above — `CallFeedItem`
 * (packages/ui/src/custom/call-feed-item.tsx) attaches its own `onClick`
 * handler internally without a `"use client"` directive on itself, so any
 * Server Component ancestor that renders it hits React's "Event handlers
 * cannot be passed to Client Component props" prerender error (confirmed:
 * `pnpm build` failed on `/en` until this boundary was added). Logged for
 * the DS cluster in docs/audit/DESIGN_REQUESTS.md rather than fixed here —
 * `packages/ui/**` is out of this cluster's ownership.
 */
export function DashboardPreview() {
  const [panelRef, settled] = useInView<HTMLDivElement>({ threshold: 0.35 });
  const calls = useCountUp(14, settled);
  const bookings = useCountUp(5, settled);
  const minutes = useCountUp(182, settled);
  const answerRate = useCountUp(100, settled);

  return (
    <div className="[perspective:1000px]">
      <div
        ref={panelRef}
        className={cn(
          "overflow-hidden rounded-2xl border border-border bg-card shadow-lg transition-[transform,opacity] duration-500 ease-(--ease-out) [transform-style:preserve-3d]",
          settled
            ? "opacity-100 sm:[transform:rotateX(0deg)_translateZ(0px)]"
            : "opacity-90 sm:[transform:rotateX(6deg)_translateZ(-40px)]",
        )}
      >
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
              <MetricCard label="Calls today" value={Math.round(calls)} format="number" delta={12.4} />
              <MetricCard
                label="Bookings today"
                value={Math.round(bookings)}
                format="number"
                delta={8.1}
              />
              <MetricCard label="Minutes used" value={Math.round(minutes)} format="number" />
              <MetricCard label="Answer rate" value={answerRate} format="percent" />
            </div>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-small font-medium text-muted-foreground">
                  Recent calls
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-0.5">
                {MOCK_CALLS.map((call, index) => (
                  <Reveal
                    key={call.id}
                    delayMs={index * ENTRANCE_STAGGER_MS.row}
                    durationMs={MOTION_DURATIONS_MS.slow}
                    translateY={8}
                  >
                    <CallFeedItem call={call} />
                  </Reveal>
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
    </div>
  );
}
