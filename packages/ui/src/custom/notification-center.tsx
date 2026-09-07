"use client";

import { Bell } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "../primitives/badge.js";
import { Button } from "../primitives/button.js";
import { Popover, PopoverContent, PopoverTrigger } from "../primitives/popover.js";
import { ScrollArea } from "../primitives/scroll-area.js";
import { EmptyState } from "./empty-error-state.js";

export interface NotificationItem {
  id: string;
  title: string;
  description?: string;
  createdAt: string;
  read: boolean;
  href?: string;
}

export interface NotificationCenterProps {
  items: NotificationItem[];
  unreadCount: number;
  onOpen: (item: NotificationItem) => void;
  renderItem?: (item: NotificationItem) => ReactNode;
}

/** Bell + unread badge + dropdown/drawer (FRONTEND_SPEC.md §1.3/§9.4) — a derived feed (new booking, usage-alert crossed, SMS pending-verification resolved, adapter disconnected, ticket reply), unread computed against `memberships.last_seen_notifications_at`. */
export function NotificationCenter({
  items,
  unreadCount,
  onOpen,
  renderItem,
}: NotificationCenterProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 h-4 min-w-4 justify-center px-1 text-[10px]"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
          <span className="sr-only">Notifications</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-border px-3 py-2 text-sm font-medium">Notifications</div>
        {items.length === 0 ? (
          <EmptyState
            title="You're all caught up"
            description="New activity will show up here."
            className="border-none"
          />
        ) : (
          <ScrollArea className="max-h-96">
            <div className="flex flex-col">
              {items.map((item) =>
                renderItem ? (
                  <div key={item.id}>{renderItem(item)}</div>
                ) : (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onOpen(item)}
                    className="flex flex-col gap-0.5 border-b border-border px-3 py-2 text-left text-sm hover:bg-secondary last:border-b-0"
                  >
                    <span className={item.read ? "text-muted-foreground" : "font-medium"}>
                      {item.title}
                    </span>
                    {item.description && (
                      <span className="text-xs text-muted-foreground">{item.description}</span>
                    )}
                  </button>
                ),
              )}
            </div>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
