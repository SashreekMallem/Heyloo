"use client";

import { Slot } from "@radix-ui/react-slot";
import { PanelLeft } from "lucide-react";
import {
  type ComponentProps,
  createContext,
  type HTMLAttributes,
  type MouseEvent,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "../lib/utils.js";
import { Button } from "./button.js";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./sheet.js";

/**
 * A deliberately simplified `sidebar` (shadcn's official block carries
 * cookie-persisted width, keyboard-shortcut toggling, and a `SidebarRail`
 * drag handle this app doesn't need — see docs/BUILD_NOTES.md T5 entry).
 * Covers what `<AppShell>` (§9.2) needs: a collapsible desktop rail that
 * becomes a `Sheet` below `md`.
 */
interface SidebarContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  /** Opens/closes the phone drawer. Opening remembers the focused element so closing can give focus back to it. */
  setOpenMobile: (open: boolean) => void;
  /** Desktop (>= md): collapses/expands the rail. Below md: opens the drawer. Never both. */
  toggleSidebar: () => void;
  /** Puts focus back on whatever opened the drawer (called when it closes). */
  restoreFocus: () => void;
}

/** Tailwind's `md` breakpoint — the width at which `<Sidebar>` switches from the `Sheet` drawer to the docked rail. */
const DESKTOP_QUERY = "(min-width: 768px)";

function isDesktopViewport(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(DESKTOP_QUERY).matches
    : false;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within <SidebarProvider>");
  return ctx;
}

export function SidebarProvider({
  defaultOpen = true,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [openMobile, setOpenMobileState] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);

  const setOpenMobile = useCallback((next: boolean) => {
    if (next && typeof document !== "undefined") {
      const active = document.activeElement;
      openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
    }
    setOpenMobileState(next);
  }, []);

  const restoreFocus = useCallback(() => {
    const opener = openerRef.current;
    if (opener?.isConnected) opener.focus();
  }, []);

  const toggleSidebar = useCallback(() => {
    if (isDesktopViewport()) setOpen((current) => !current);
    else setOpenMobile(true);
  }, [setOpenMobile]);

  const value = useMemo(
    () => ({ open, setOpen, openMobile, setOpenMobile, toggleSidebar, restoreFocus }),
    [open, openMobile, setOpenMobile, toggleSidebar, restoreFocus],
  );

  return (
    <SidebarContext.Provider value={value}>
      <div className={cn("flex min-h-svh w-full", className)} {...props}>
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

export function Sidebar({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const { open, openMobile, setOpenMobile, restoreFocus } = useSidebar();
  return (
    <>
      <div className="hidden md:block">
        <div
          className={cn(
            "sticky top-0 h-svh shrink-0 border-r border-border bg-card transition-[width] duration-150",
            open ? "w-64" : "w-0 overflow-hidden",
          )}
        >
          <div className={cn("flex h-full w-64 flex-col", className)} {...props}>
            {children}
          </div>
        </div>
      </div>
      <div className="md:hidden">
        <Sheet open={openMobile} onOpenChange={setOpenMobile}>
          <SheetContent
            side="left"
            className="w-64 p-0"
            // Radix's modal Dialog sends focus back to its own <Trigger> on
            // close — there is none here (the toggle is a plain Button), so
            // without this focus fell to <body> (QA-1 MAP-11).
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              restoreFocus();
            }}
          >
            {/* An accessible name for the dialog (axe aria-dialog-name). Radix also warns when a Description is missing, so both exist, visually hidden. */}
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">Site navigation</SheetDescription>
            <div className={cn("flex h-full flex-col", className)}>{children}</div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}

export function SidebarTrigger({ className, onClick, ...props }: ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar();
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(className)}
      {...props}
      // One action per viewport: the docked rail collapses on desktop, the
      // drawer opens on phones. It used to do both, so on desktop a modal
      // duplicate of the visible sidebar opened over it (QA-1 COCKPIT-F22).
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) toggleSidebar();
      }}
    >
      <PanelLeft className="size-4" />
      <span className="sr-only">Toggle sidebar</span>
    </Button>
  );
}

export function SidebarHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-2 p-4", className)} {...props} />;
}

export function SidebarFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-auto flex flex-col gap-2 p-4", className)} {...props} />;
}

export function SidebarContent({
  className,
  asChild,
  ...props
}: HTMLAttributes<HTMLDivElement> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "div";
  return <Comp className={cn("flex-1 overflow-y-auto px-2", className)} {...props} />;
}

export function SidebarGroup({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 py-2", className)} {...props} />;
}

export function SidebarGroupLabel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarMenu({ className, ...props }: HTMLAttributes<HTMLUListElement>) {
  return <ul className={cn("flex flex-col gap-0.5", className)} {...props} />;
}

export function SidebarMenuItem({ className, ...props }: HTMLAttributes<HTMLLIElement>) {
  return <li className={cn(className)} {...props} />;
}

export function SidebarMenuButton({
  className,
  isActive,
  asChild,
  onClick,
  ...props
}: ComponentProps<"button"> & { isActive?: boolean; asChild?: boolean }) {
  const { openMobile, setOpenMobile } = useSidebar();
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-active={isActive}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        // py-2.5 below lg keeps each row >= 44px tall for touch (QA-1 MAP-05).
        "flex w-full items-center gap-2 rounded-md px-2 py-2.5 text-sm transition-colors hover:bg-secondary data-[active=true]:bg-secondary data-[active=true]:font-medium lg:py-1.5",
        className,
      )}
      {...props}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        // Choosing a destination dismisses the phone drawer; without this it
        // stayed open over the new page (QA-1 MAP-01).
        if (openMobile) setOpenMobile(false);
      }}
    />
  );
}

export { useSidebar };
