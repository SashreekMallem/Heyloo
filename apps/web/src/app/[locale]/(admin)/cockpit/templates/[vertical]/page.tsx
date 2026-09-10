"use client";

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataState,
  Label,
  PageHeader,
  type SimulationCaseResult,
  SimulationResultsPanel,
  Textarea,
} from "@heyloo/ui";
import { use, useState } from "react";
import { toast } from "sonner";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

interface TemplateEditorData {
  system_prompt: string;
  states: unknown[];
  transitions: unknown[];
  tools: unknown[];
}

interface PublishGateResult {
  results: SimulationCaseResult[];
  costEstimatePerCall: number;
  disclosureIntegrityOk: boolean;
}

/** Structured-form editor (FRONTEND_SPEC.md §7.4 DECIDE — a visual state-graph canvas is future scope; V1 ships JSON sub-fields for states/transitions/tools). */
export default function TemplateEditorPage({ params }: { params: Promise<{ vertical: string }> }) {
  const { vertical } = use(params);
  const query = useAdminQuery<TemplateEditorData>(
    "template-detail",
    [vertical],
    `admin-templates/${vertical}`,
  );
  const [systemPrompt, setSystemPrompt] = useState("");
  const [statesJson, setStatesJson] = useState("[]");
  const [gate, setGate] = useState<PublishGateResult | null>(null);
  const [publishing, setPublishing] = useState(false);

  async function runPublishGate() {
    setPublishing(true);
    const res = await fetch(`/api/admin/admin-templates/${vertical}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ system_prompt: systemPrompt, states: safeParse(statesJson) }),
    });
    setPublishing(false);
    if (!res.ok) {
      toast.error("Publish gate isn't available yet — backend endpoint pending.");
      return;
    }
    setGate((await res.json()) as PublishGateResult);
  }

  return (
    <div className="space-y-6">
      <PageHeader title={`${vertical.replace(/_/g, " ")} template`} className="capitalize" />

      <DataState
        query={query}
        empty={{ title: "No published version yet" }}
        render={(data) => (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">System prompt</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="template-system-prompt" className="sr-only">
                  System prompt
                </Label>
                <Textarea
                  id="template-system-prompt"
                  className="min-h-40"
                  defaultValue={data.system_prompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label
                  htmlFor="template-states-json"
                  className="mb-1 text-xs font-medium text-muted-foreground"
                >
                  States (JSON)
                </Label>
                <Textarea
                  id="template-states-json"
                  className="min-h-40 font-mono text-xs"
                  defaultValue={JSON.stringify(data.states, null, 2)}
                  onChange={(e) => setStatesJson(e.target.value)}
                />
              </div>
              <Button onClick={runPublishGate} disabled={publishing}>
                Run publish gate
              </Button>
            </CardContent>
          </Card>
        )}
      />

      {gate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Simulation results</CardTitle>
          </CardHeader>
          <CardContent>
            <SimulationResultsPanel
              results={gate.results}
              costEstimatePerCall={gate.costEstimatePerCall}
              disclosureIntegrityOk={gate.disclosureIntegrityOk}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}
