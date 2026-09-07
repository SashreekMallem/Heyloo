import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../lib/utils.js";
import { Button, type ButtonProps } from "./button.js";

export function Pagination({ className, ...props }: ComponentProps<"nav">) {
  return (
    <nav
      aria-label="pagination"
      className={cn("mx-auto flex w-full justify-center", className)}
      {...props}
    />
  );
}

export function PaginationContent({ className, ...props }: ComponentProps<"ul">) {
  return <ul className={cn("flex flex-row items-center gap-1", className)} {...props} />;
}

export function PaginationItem({ ...props }: ComponentProps<"li">) {
  return <li {...props} />;
}

export function PaginationLink({
  className,
  isActive,
  size = "icon",
  ...props
}: ComponentProps<"button"> & Pick<ButtonProps, "size"> & { isActive?: boolean }) {
  return (
    <Button
      variant={isActive ? "outline" : "ghost"}
      size={size}
      aria-current={isActive ? "page" : undefined}
      className={cn(className)}
      {...props}
    />
  );
}

export function PaginationPrevious({ className, ...props }: ComponentProps<"button">) {
  return (
    <PaginationLink
      aria-label="Previous page"
      size="default"
      className={cn("gap-1 px-2.5", className)}
      {...props}
    >
      <ChevronLeft className="size-4" />
      <span>Previous</span>
    </PaginationLink>
  );
}

export function PaginationNext({ className, ...props }: ComponentProps<"button">) {
  return (
    <PaginationLink
      aria-label="Next page"
      size="default"
      className={cn("gap-1 px-2.5", className)}
      {...props}
    >
      <span>Next</span>
      <ChevronRight className="size-4" />
    </PaginationLink>
  );
}

export function PaginationEllipsis({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      aria-hidden
      className={cn("flex size-9 items-center justify-center", className)}
      {...props}
    >
      <MoreHorizontal className="size-4" />
      <span className="sr-only">More pages</span>
    </span>
  );
}
