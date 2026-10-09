"use client";

import { Badge, Button, formatPhoneDisplay } from "@heyloo/ui";
import { formatAge } from "@/lib/live/format";
import type { LiveMessage } from "@/lib/live/types";
import { LiveSection } from "./section";

export function MessagesFeed({
  messages,
  isNew,
  now,
  state,
  onAcknowledge,
  onAcknowledgeAll,
}: {
  messages: LiveMessage[];
  isNew: (message: LiveMessage) => boolean;
  now: Date;
  state: "loading" | "error" | "ready";
  onAcknowledge: (message: LiveMessage) => void;
  onAcknowledgeAll: () => void;
}) {
  const newCount = messages.filter(isNew).length;
  return (
    <LiveSection
      id="live-messages"
      title="Messages"
      count={messages.length}
      state={state}
      errorText="Couldn't load messages. Trying again every 15 seconds."
      action={
        newCount > 1 ? (
          <Button type="button" variant="outline" size="sm" onClick={onAcknowledgeAll}>
            Mark all seen
          </Button>
        ) : null
      }
    >
      {messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">No messages in the last 24 hours.</p>
      ) : (
        <ul className="space-y-3">
          {messages.map((message) => {
            const fresh = isNew(message);
            return (
              <li
                key={message.id}
                className={
                  fresh
                    ? "rounded-lg border-2 border-primary bg-card p-3"
                    : "rounded-lg border border-border bg-card p-3"
                }
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-base font-semibold">
                    {message.callerName ?? "Caller"}
                    {message.callerPhone && (
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        · {formatPhoneDisplay(message.callerPhone)}
                      </span>
                    )}
                  </p>
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    {formatAge(message.createdAt, now)}
                    {fresh && <Badge>New</Badge>}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-line text-base">{message.message}</p>
                {message.callbackWindow && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Best time to call back: {message.callbackWindow}
                  </p>
                )}
                {fresh && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => onAcknowledge(message)}
                  >
                    Got it
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </LiveSection>
  );
}
