import { EmptyState } from "@heyloo/ui";
import { PhoneOff } from "lucide-react";
import { Link } from "@/i18n/navigation";

export default function CallNotFound() {
  return (
    <EmptyState
      className="mt-10 border-none"
      icon={<PhoneOff className="size-8" />}
      title="Call not found"
      description="This call doesn't exist or you don't have access to it."
      action={
        <Link
          href="/dashboard/calls"
          className="text-sm font-medium text-primary underline underline-offset-2"
        >
          Back to calls
        </Link>
      }
    />
  );
}
