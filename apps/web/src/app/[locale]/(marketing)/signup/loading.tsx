import { Skeleton } from "@heyloo/ui";

export default function SignupLoading() {
  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-16">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
