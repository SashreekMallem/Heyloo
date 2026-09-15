import { Skeleton } from "@heyloo/ui/primitives/skeleton";

export default function CockpitLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
