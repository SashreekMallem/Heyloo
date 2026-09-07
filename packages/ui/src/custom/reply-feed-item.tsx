import { Badge } from "../primitives/badge.js";
import { Button } from "../primitives/button.js";
import { Card, CardContent } from "../primitives/card.js";

export type ReplyIntent =
  | "interested"
  | "not_interested"
  | "unsubscribe"
  | "question"
  | "auto_reply"
  | null;

export interface ReplyData {
  id: string;
  leadName: string;
  body: string;
  intent: ReplyIntent;
  receivedAt: string;
}

export interface ReplyFeedItemProps {
  reply: ReplyData;
  onAction: (action: string) => void;
}

const INTENT_ACTIONS: Record<string, { label: string; action: string; variant?: "destructive" }[]> =
  {
    interested: [{ label: "Mark qualified", action: "qualify" }],
    not_interested: [{ label: "Archive", action: "archive" }],
    unsubscribe: [{ label: "Confirm unsubscribe", action: "unsubscribe", variant: "destructive" }],
    question: [{ label: "Reply", action: "reply" }],
    auto_reply: [{ label: "Dismiss", action: "dismiss" }],
  };

/** Reply row w/ intent badge + one-click actions — outreach replies (FRONTEND_SPEC.md §1.3/§7.3). "unsubscribe" acts instantly (CAN-SPAM-critical). */
export function ReplyFeedItem({ reply, onAction }: ReplyFeedItemProps) {
  const actions = reply.intent ? (INTENT_ACTIONS[reply.intent] ?? []) : [];
  return (
    <Card>
      <CardContent className="space-y-2 py-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">{reply.leadName}</p>
          {reply.intent && <Badge variant="outline">{reply.intent.replace(/_/g, " ")}</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">{reply.body}</p>
        <div className="flex gap-2">
          {actions.map((action) => (
            <Button
              key={action.action}
              size="sm"
              variant={action.variant ?? "outline"}
              onClick={() => onAction(action.action)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
