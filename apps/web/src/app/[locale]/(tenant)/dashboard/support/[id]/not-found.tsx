import { EmptyState } from "@heyloo/ui";
import { FileQuestion } from "lucide-react";
import { Link } from "@/i18n/navigation";

export default function TicketNotFound() {
  return (
    <EmptyState
      className="mt-10 border-none"
      icon={<FileQuestion className="size-8" />}
      title="Ticket not found"
      description="This support ticket doesn't exist or you don't have access to it."
      action={
        <Link
          href="/dashboard/support"
          className="text-sm font-medium text-accent-text underline underline-offset-2"
        >
          Back to support
        </Link>
      }
    />
  );
}
