import type { ReactElement, ReactNode } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../primitives/sidebar.js";
import { type NavItem, resolveActiveNavHref } from "./nav-types.js";

export interface NavSection {
  label?: string;
  items: NavItem[];
}

export interface AppSidebarNavProps {
  sections: NavSection[];
  activeHref: string;
  header?: ReactNode;
  footer?: ReactNode;
  /** Accessible name of the `<nav>` landmark wrapping the link groups. */
  navLabel?: string;
  /** Render prop so the caller supplies the app's own link component (Next's `<Link>`) — packages/ui has no Next.js dependency. */
  renderLink: (item: NavItem, isActive: boolean) => ReactElement;
}

/** `<Sidebar>` content for the tenant/admin/partner nav lists in FRONTEND_SPEC.md §9.2 — built on the `sidebar` primitive. */
export function AppSidebarNav({
  sections,
  activeHref,
  header,
  footer,
  navLabel = "Main",
  renderLink,
}: AppSidebarNavProps) {
  // One current item across ALL sections — the longest matching href — so a
  // section root (`/dashboard`) is never lit up next to its child (QA-1 F-01).
  const currentHref = resolveActiveNavHref(
    sections.flatMap((section) => section.items),
    activeHref,
  );
  return (
    <Sidebar>
      {header && <SidebarHeader>{header}</SidebarHeader>}
      <SidebarContent asChild>
        <nav aria-label={navLabel}>
          {sections.map((section, index) => (
            <SidebarGroup key={section.label ?? index}>
              {section.label && <SidebarGroupLabel>{section.label}</SidebarGroupLabel>}
              <SidebarMenu>
                {section.items.map((item) => {
                  const isActive = item.href === currentHref;
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={isActive}>
                        {renderLink(item, isActive)}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </nav>
      </SidebarContent>
      {footer && <SidebarFooter>{footer}</SidebarFooter>}
    </Sidebar>
  );
}
