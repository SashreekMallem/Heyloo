import { EmptyState } from "@heyloo/ui/custom/empty-error-state";
import { ShoppingBag } from "lucide-react";
import { Link } from "@/i18n/navigation";

/** Unknown / cross-tenant order id — keeps the app chrome instead of the bare framework 404 (QA-1 MAP-13). */
export default function OrderNotFound() {
  return (
    <EmptyState
      className="mt-10 border-none"
      icon={<ShoppingBag className="size-8" />}
      title="Order not found"
      description="This order doesn't exist or you don't have access to it."
      action={
        <Link
          href="/dashboard/orders"
          className="text-sm font-medium text-accent-text underline underline-offset-2"
        >
          Back to orders
        </Link>
      }
    />
  );
}
