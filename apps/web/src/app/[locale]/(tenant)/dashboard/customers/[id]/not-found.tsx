import { EmptyState } from "@heyloo/ui";
import { UserX } from "lucide-react";
import { Link } from "@/i18n/navigation";

export default function CustomerNotFound() {
  return (
    <EmptyState
      className="mt-10 border-none"
      icon={<UserX className="size-8" />}
      title="Customer not found"
      description="This customer doesn't exist or you don't have access to them."
      action={
        <Link
          href="/dashboard/customers"
          className="text-sm font-medium text-accent-text underline underline-offset-2"
        >
          Back to customers
        </Link>
      }
    />
  );
}
