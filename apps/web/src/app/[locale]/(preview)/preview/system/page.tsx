"use client";

import type { Vertical } from "@heyloo/canonical-types";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Callout,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Container,
  DataList,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  ErrorState,
  ImpersonationBanner,
  Input,
  MetricCard,
  NAV_ICONS,
  PageHeader,
  Section,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Skeleton,
  StatusBadge,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  ThemeToggle,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  TranscriptViewer,
  VerticalIcon,
  WizardStepper,
} from "@heyloo/ui";
import type { ReactNode } from "react";
import { toast } from "sonner";

const VERTICALS: Vertical[] = [
  "auto",
  "vet",
  "legal",
  "dental",
  "real_estate",
  "motel",
  "restaurant",
  "generic",
];
const BUTTON_VARIANTS = [
  "default",
  "secondary",
  "outline",
  "ghost",
  "destructive",
  "link",
] as const;
const CALLOUT_TONES = ["neutral", "info", "success", "warning", "danger"] as const;

// Computed once at module evaluation (not during render) so the React
// Compiler purity rule — which forbids calling impure APIs like `Date.now()`
// in a component/hook body — doesn't apply; this is static fixture data for
// the gallery, not a live countdown.
const IMPERSONATION_BANNER_EXPIRES_AT = new Date(Date.now() + 8 * 60_000).toISOString();

/** Every shared component in one place, both themes side by side — for reviewer screenshots (docs/DESIGN_SYSTEM.md §UI Preview Mode). Covers the core/shared set named in the DS brief, not literally every one of packages/ui's ~60 exports. */
export default function ComponentGalleryPage() {
  return (
    <TooltipProvider>
      <Container size="full">
        <Section spacing="compact">
          <PageHeader
            eyebrow="Heyloo design system"
            title="Component gallery"
            description="Every core shared component, rendered in a forced-light and a forced-dark panel regardless of your own theme preference."
            actions={<ThemeToggle />}
          />
        </Section>

        <div className="space-y-10 pb-20">
          <GallerySection title="Buttons">
            {BUTTON_VARIANTS.map((variant) => (
              <div key={variant} className="flex flex-wrap items-center gap-3">
                <Button variant={variant} size="sm">
                  {variant}
                </Button>
                <Button variant={variant}>{variant}</Button>
                <Button variant={variant} size="lg">
                  {variant}
                </Button>
                <Button variant={variant} loading>
                  {variant}
                </Button>
                <Button variant={variant} disabled>
                  {variant}
                </Button>
              </div>
            ))}
          </GallerySection>

          <GallerySection title="Badges & status pills">
            <div className="flex flex-wrap gap-2">
              <Badge>default</Badge>
              <Badge variant="secondary">secondary</Badge>
              <Badge variant="outline">outline</Badge>
              <Badge variant="success">success</Badge>
              <Badge variant="warning">warning</Badge>
              <Badge variant="destructive">destructive</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge variant="booking" value="confirmed" />
              <StatusBadge variant="booking" value="cancelled" />
              <StatusBadge variant="call-class" value="new_booking" />
              <StatusBadge variant="tenant" value="past_due" />
            </div>
          </GallerySection>

          <GallerySection title="Form controls">
            <div className="grid max-w-md gap-3">
              <Input placeholder="Business name" />
              <Textarea placeholder="Greeting script…" rows={3} />
              <Select defaultValue="auto">
                <SelectTrigger>
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
              <div className="flex items-center gap-2">
                <Checkbox id="gallery-checkbox" defaultChecked />
                <label htmlFor="gallery-checkbox" className="text-small">
                  Text customers a booking confirmation
                </label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="gallery-switch" defaultChecked />
                <label htmlFor="gallery-switch" className="text-small">
                  Manual mode
                </label>
              </div>
            </div>
          </GallerySection>

          <GallerySection title="Cards & KPI tiles">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <MetricCard label="Calls this week" value={128} delta={12.4} format="number" />
              <MetricCard label="Revenue booked" value={482_500} delta={-3.1} format="currency" />
              <MetricCard label="Avg. call length" value={143} format="duration" />
            </div>
            <Card className="max-w-md">
              <CardHeader>
                <CardTitle>Golden Fork Bistro</CardTitle>
                <CardDescription>Restaurant · active since Mar 2026</CardDescription>
              </CardHeader>
              <CardContent>
                <DataList
                  items={[
                    { label: "Phone", value: "+1 512 555 0142", mono: true },
                    { label: "Plan", value: "Answer & Book" },
                    { label: "MRR", value: "$249.00", mono: true },
                  ]}
                />
              </CardContent>
            </Card>
          </GallerySection>

          <GallerySection title="Tabs">
            <Tabs defaultValue="hours" className="max-w-md">
              <TabsList>
                <TabsTrigger value="hours">Hours</TabsTrigger>
                <TabsTrigger value="faq">FAQ</TabsTrigger>
                <TabsTrigger value="greeting">Greeting</TabsTrigger>
              </TabsList>
              <TabsContent value="hours" className="text-small text-muted-foreground">
                Mon–Thu 11am–9pm, Fri–Sat 11am–11pm, Sun 10am–8pm.
              </TabsContent>
              <TabsContent value="faq" className="text-small text-muted-foreground">
                12 questions configured.
              </TabsContent>
              <TabsContent value="greeting" className="text-small text-muted-foreground">
                &ldquo;Thanks for calling Golden Fork Bistro — this call may be recorded.&rdquo;
              </TabsContent>
            </Tabs>
          </GallerySection>

          <GallerySection title="Overlays">
            <div className="flex flex-wrap gap-3">
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline">Open dialog</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Cancel booking?</DialogTitle>
                  </DialogHeader>
                  <p className="text-small text-muted-foreground">
                    The customer will be notified by SMS.
                  </p>
                </DialogContent>
              </Dialog>
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="outline">Open sheet</Button>
                </SheetTrigger>
                <SheetContent>
                  <SheetHeader>
                    <SheetTitle>Booking detail</SheetTitle>
                  </SheetHeader>
                </SheetContent>
              </Sheet>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline">Hover for tooltip</Button>
                </TooltipTrigger>
                <TooltipContent>Identity verified by phone match</TooltipContent>
              </Tooltip>
              <Button variant="outline" onClick={() => toast.success("Customer notified by SMS")}>
                Fire a toast
              </Button>
            </div>
          </GallerySection>

          <GallerySection title="Loading & empty/error states">
            <div className="flex flex-wrap items-center gap-3">
              <Skeleton className="h-9 w-32" />
              <Skeleton className="size-9 rounded-full" />
              <Skeleton className="h-4 w-48" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <EmptyState
                title="No bookings yet"
                description="Confirmed bookings will show up here."
              />
              <ErrorState message="Couldn't load this page." eventId="evt_abc123" />
            </div>
          </GallerySection>

          <GallerySection title="Callouts">
            <div className="grid gap-3 sm:grid-cols-2">
              {CALLOUT_TONES.map((tone) => (
                <Callout key={tone} tone={tone} title={`${tone} callout`}>
                  Consent is on file for this customer (SMS + call).
                </Callout>
              ))}
            </div>
          </GallerySection>

          <GallerySection title="Transcript / timeline">
            <TranscriptViewer
              turns={[
                { speaker: "agent", text: "Thanks for calling — how can I help?", ts: 0 },
                { speaker: "caller", text: "I'd like a table for four tonight.", ts: 4 },
                { speaker: "agent", text: "I can do 7:15 — would that work?", ts: 9 },
              ]}
            />
          </GallerySection>

          <GallerySection title="Stepper & impersonation banner">
            <WizardStepper
              steps={["Plan", "Business info", "Forwarding", "Live"]}
              current={2}
              completed={[0, 1]}
            />
            <ImpersonationBanner
              tenantName="Golden Fork Bistro"
              adminEmail="admin@heyloo.example"
              expiresAt={IMPERSONATION_BANNER_EXPIRES_AT}
              editMode={false}
              onEnd={() => {}}
              onToggleEdit={() => {}}
            />
          </GallerySection>

          <GallerySection title="Avatars & icons">
            <div className="flex flex-wrap items-center gap-3">
              <Avatar>
                <AvatarFallback>GF</AvatarFallback>
              </Avatar>
              <Avatar>
                <AvatarFallback>+3</AvatarFallback>
              </Avatar>
            </div>
            <div className="flex flex-wrap gap-4">
              {VERTICALS.map((v) => (
                <div
                  key={v}
                  className="flex flex-col items-center gap-1 text-micro text-muted-foreground"
                >
                  <VerticalIcon vertical={v} className="size-6" />
                  {v}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-4">
              {Object.entries(NAV_ICONS)
                .slice(0, 10)
                .map(([name, Icon]) => (
                  <div
                    key={name}
                    className="flex flex-col items-center gap-1 text-micro text-muted-foreground"
                  >
                    <Icon className="size-5" aria-hidden="true" />
                    {name}
                  </div>
                ))}
            </div>
          </GallerySection>
        </div>
      </Container>
    </TooltipProvider>
  );
}

function GallerySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-4 text-h4 font-semibold">{title}</h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="heyloo-theme-light space-y-4 rounded-lg border border-border p-5">
          <p className="text-micro font-medium uppercase tracking-wide text-muted-foreground">
            Light
          </p>
          {children}
        </div>
        <div className="heyloo-theme-dark space-y-4 rounded-lg border border-border p-5">
          <p className="text-micro font-medium uppercase tracking-wide text-muted-foreground">
            Dark
          </p>
          {children}
        </div>
      </div>
    </section>
  );
}
