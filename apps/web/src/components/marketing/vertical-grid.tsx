import { VerticalIcon } from "@heyloo/ui";
import { ArrowRight } from "lucide-react";
import { VERTICAL_CONTENT } from "@/content/marketing/verticals";
import { Link } from "@/i18n/navigation";

/**
 * Business-type grid (DESIGN BRIEF: "business-type grid with VerticalIcon
 * and one outcome line each"). `generic` ("Any Service Business") is kept
 * last as the catch-all rather than dropped — it's a real signup path.
 */
export function VerticalGrid() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {VERTICAL_CONTENT.map((vertical) => (
        <Link
          key={vertical.slug}
          href={`/${vertical.slug}`}
          className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-5 text-left shadow-xs transition-[border-color,box-shadow,transform] duration-(--duration-fast) ease-(--ease-out) hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <span className="flex size-10 items-center justify-center rounded-lg bg-secondary text-foreground">
            <VerticalIcon vertical={vertical.vertical} className="size-5" />
          </span>
          <div className="space-y-1">
            <p className="text-small font-semibold">{vertical.displayName}</p>
            <p className="text-small text-pretty text-muted-foreground line-clamp-2">
              {vertical.heroStat}
            </p>
          </div>
          <span className="mt-auto inline-flex items-center gap-1 text-small font-medium text-primary opacity-0 transition-opacity duration-(--duration-fast) group-hover:opacity-100 group-focus-visible:opacity-100">
            See what it handles
            <ArrowRight className="size-3.5" />
          </span>
        </Link>
      ))}
    </div>
  );
}
