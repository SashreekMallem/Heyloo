"use client";

import { configLabScenarioSchema, VERTICALS } from "@heyloo/canonical-types";
import {
  Button,
  Callout,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@heyloo/ui";
import { MarginWaterfall, type WaterfallSegment } from "@heyloo/ui/charts";
import { useState } from "react";
import { toast } from "sonner";

interface SimulationResult {
  before: WaterfallSegment[];
  after: WaterfallSegment[];
}

/** Non-destructive margin what-if — distinct from the template publish gate's simulation (FRONTEND_SPEC.md §7.1.5). */
export default function ConfigLabPage() {
  const [name, setName] = useState("");
  const [vertical, setVertical] = useState<string>("generic");
  const [llmTier, setLlmTier] = useState("standard");
  const [voiceTier, setVoiceTier] = useState("standard");
  const [volume, setVolume] = useState(1000);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [running, setRunning] = useState(false);

  async function runSimulation() {
    const parsed = configLabScenarioSchema.safeParse({
      name: name || "Untitled scenario",
      vertical,
      llm_tier: llmTier,
      voice_tier: voiceTier,
      assumed_volume: volume,
    });
    if (!parsed.success) {
      toast.error("Check the scenario inputs.");
      return;
    }
    setRunning(true);
    const res = await fetch("/api/admin/admin-config-lab/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsed.data),
    });
    setRunning(false);
    if (!res.ok) {
      toast.error("Simulation isn't available yet.");
      return;
    }
    setResult((await res.json()) as SimulationResult);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Config Lab"
        description="Model a pricing/tier change before it ever touches a live customer."
      />
      <Callout tone="warning">Simulation only — no changes are applied to live pricing.</Callout>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scenario</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Input
            placeholder="Scenario name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Select value={vertical} onValueChange={setVertical}>
            <SelectTrigger aria-label="Vertical">
              <SelectValue placeholder="Vertical" />
            </SelectTrigger>
            <SelectContent>
              {VERTICALS.map((v) => (
                <SelectItem key={v} value={v} className="capitalize">
                  {v.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={llmTier} onValueChange={setLlmTier}>
            <SelectTrigger aria-label="LLM tier">
              <SelectValue placeholder="LLM tier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="economy">LLM: Economy</SelectItem>
              <SelectItem value="standard">LLM: Standard</SelectItem>
              <SelectItem value="premium">LLM: Premium</SelectItem>
            </SelectContent>
          </Select>
          <Select value={voiceTier} onValueChange={setVoiceTier}>
            <SelectTrigger aria-label="Voice tier">
              <SelectValue placeholder="Voice tier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="economy">Voice: Economy</SelectItem>
              <SelectItem value="standard">Voice: Standard</SelectItem>
              <SelectItem value="premium">Voice: Premium</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="number"
            placeholder="Assumed monthly call volume"
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
          <Button onClick={runSimulation} disabled={running}>
            Run simulation
          </Button>
        </CardContent>
      </Card>

      {result && (
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <h2 className="mb-2 text-small font-medium text-muted-foreground">Before</h2>
            <MarginWaterfall segments={result.before} />
          </div>
          <div>
            <h2 className="mb-2 text-small font-medium text-muted-foreground">After</h2>
            <MarginWaterfall segments={result.after} />
          </div>
        </div>
      )}
    </div>
  );
}
