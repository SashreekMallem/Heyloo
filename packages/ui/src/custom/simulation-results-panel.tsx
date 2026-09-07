import { formatCentsUSD } from "@heyloo/canonical-types";
import { CheckCircle2, ShieldAlert, XCircle } from "lucide-react";
import { Badge } from "../primitives/badge.js";

export interface SimulationCaseResult {
  caseId: string;
  pass: boolean;
  note?: string;
}

export interface SimulationResultsPanelProps {
  results: SimulationCaseResult[];
  costEstimatePerCall: number;
  disclosureIntegrityOk: boolean;
}

/**
 * Red-team + batch-sim pass/fail before publish (FRONTEND_SPEC.md
 * §1.3/§7.4). The disclosure-integrity check is a hard block with NO
 * override — compiler-enforced, non-negotiable, never surfaced as
 * dismissible here even visually.
 */
export function SimulationResultsPanel({
  results,
  costEstimatePerCall,
  disclosureIntegrityOk,
}: SimulationResultsPanelProps) {
  const failing = results.filter((r) => !r.pass);
  return (
    <div className="space-y-4">
      <div
        className={
          disclosureIntegrityOk
            ? "flex items-center gap-2 rounded-md border border-success/40 bg-success/10 p-3 text-sm text-success"
            : "flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        }
      >
        {disclosureIntegrityOk ? (
          <CheckCircle2 className="size-4" />
        ) : (
          <ShieldAlert className="size-4" />
        )}
        <span className="font-medium">
          {disclosureIntegrityOk
            ? "Disclosure line integrity check passed."
            : "Disclosure line integrity check FAILED — publish is blocked. This cannot be overridden."}
        </span>
      </div>

      <p className="text-sm text-muted-foreground">
        Estimated cost per simulated call:{" "}
        <strong className="font-medium text-foreground">
          {formatCentsUSD(costEstimatePerCall)}
        </strong>
        {" · "}
        {failing.length === 0
          ? "All cases passed."
          : `${failing.length} of ${results.length} cases failed.`}
      </p>

      <ul className="space-y-1">
        {results.map((result) => (
          <li key={result.caseId} className="flex items-center gap-2 text-sm">
            {result.pass ? (
              <CheckCircle2 className="size-4 shrink-0 text-success" />
            ) : (
              <XCircle className="size-4 shrink-0 text-destructive" />
            )}
            <span className="font-mono text-xs">{result.caseId}</span>
            {result.note && <span className="text-muted-foreground">— {result.note}</span>}
            {!result.pass && <Badge variant="destructive">override requires justification</Badge>}
          </li>
        ))}
      </ul>
    </div>
  );
}
