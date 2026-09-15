import { Skeleton } from "@heyloo/ui/primitives/skeleton";

export default function PortalLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
