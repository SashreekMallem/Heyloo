"use client";

import { Slot } from "@radix-ui/react-slot";
import { PanelLeft } from "lucide-react";
import {
  type ComponentProps,
  createContext,
  type HTMLAttributes,
  useContext,
  useState,
} from "react";
import { cn } from "../lib/utils.js";
import { Button } from "./button.js";
import { Sheet, SheetContent } from "./sheet.js";

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
  setOpenMobile: (open: boolean) => void;
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
  const [openMobile, setOpenMobile] = useState(false);
  return (
    <SidebarContext.Provider value={{ open, setOpen, openMobile, setOpenMobile }}>
      <div className={cn("flex min-h-svh w-full", className)} {...props}>
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

export function Sidebar({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const { open, openMobile, setOpenMobile } = useSidebar();
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
          <SheetContent side="left" className="w-64 p-0">
            <div className={cn("flex h-full flex-col", className)}>{children}</div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}

export function SidebarTrigger({ className, ...props }: ComponentProps<typeof Button>) {
  const { open, setOpen, setOpenMobile } = useSidebar();
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(className)}
      onClick={() => {
        setOpen(!open);
        setOpenMobile(true);
      }}
      {...props}
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

export function SidebarContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex-1 overflow-y-auto px-2", className)} {...props} />;
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
  ...props
}: ComponentProps<"button"> & { isActive?: boolean; asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-active={isActive}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-secondary data-[active=true]:bg-secondary data-[active=true]:font-medium",
        className,
      )}
      {...props}
    />
  );
}

export { useSidebar };
