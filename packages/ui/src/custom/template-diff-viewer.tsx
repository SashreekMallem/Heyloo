import { cn } from "../lib/utils.js";

export interface TemplateDiffViewerProps {
  before: string;
  after: string;
  className?: string;
}

/** Version-to-version diff of prompt/tools/graph — template editor (FRONTEND_SPEC.md §1.3/§7.4). Line-level unified diff, dependency-free (no diff library — a monorepo already this dependency-heavy doesn't need one more for a lightly-used admin view). */
export function TemplateDiffViewer({ before, after, className }: TemplateDiffViewerProps) {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);

  return (
    <div className={cn("grid grid-cols-1 gap-4 md:grid-cols-2", className)}>
      <div className="overflow-x-auto rounded-md border border-border">
        <div className="border-b border-border bg-muted px-3 py-1.5 text-xs font-medium">
          Previous version
        </div>
        <pre className="p-3 text-xs">
          {beforeLines.map((line, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: line position in the diff is the identity; text repeats
              key={i}
              className={!afterSet.has(line) ? "bg-destructive/10 text-destructive" : undefined}
            >
              {line || " "}
            </div>
          ))}
        </pre>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <div className="border-b border-border bg-muted px-3 py-1.5 text-xs font-medium">
          New version
        </div>
        <pre className="p-3 text-xs">
          {afterLines.map((line, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: line position in the diff is the identity; text repeats
              key={i}
              className={!beforeSet.has(line) ? "bg-success/10 text-success" : undefined}
            >
              {line || " "}
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
