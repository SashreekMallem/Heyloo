"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Callout,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataState,
  Label,
  PageHeader,
  Textarea,
} from "@heyloo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

/** `GET admin-templates/:key` answers `{ template: <agent_templates row> }` (supabase/functions/admin/handler.ts). */
export interface TemplateRow {
  id: string;
  vertical: string;
  name: string;
  version: number;
  is_active: boolean;
  system_prompt: string | null;
  states: unknown[] | null;
}

interface TemplateResponse {
  template: TemplateRow;
}

interface PublishResult {
  published: boolean;
  template_id: string;
  retell_agent_id: string;
  retell_flow_id: string;
}

function prettyStates(states: unknown[] | null): string {
  return JSON.stringify(states ?? [], null, 2);
}

/** `null` when the text is not a JSON array (the `states` column is always an array). */
function parseStates(text: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function errorCode(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : null;
  } catch {
    return null;
  }
}

/** Human text for a failed save/publish; never claims the live agent is unchanged when the server errored after the provider call. */
function failureMessage(action: "save" | "publish", status: number, code: string | null): string {
  if (code === "retell_publish_not_configured") {
    return "Retell isn't configured for this deployment, so nothing was published.";
  }
  if (code === "disclosure_gate_failed") {
    return "The compiled agent is missing the required AI + recording disclosure. Nothing was published.";
  }
  if (code?.startsWith("retell_")) {
    return `Retell rejected the publish (${code}). The template was not activated.`;
  }
  if (status === 403) return "Only a signed-in platform admin with MFA can do this.";
  if (status === 404) return "This template no longer exists. Reload the page.";
  if (status === 422) return "The server rejected the edits. Check the prompt and states JSON.";
  if (action === "publish") {
    return `The server returned an error (HTTP ${status}). Check Retell before retrying: the publish may have partly completed.`;
  }
  return `Couldn't save the draft (HTTP ${status}). Please try again.`;
}

function EditorBody({ template }: { template: TemplateRow }) {
  const queryClient = useQueryClient();
  const initialPrompt = template.system_prompt ?? "";
  const initialStates = prettyStates(template.states);
  const [systemPrompt, setSystemPrompt] = useState(initialPrompt);
  const [statesJson, setStatesJson] = useState(initialStates);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [published, setPublished] = useState<PublishResult | null>(null);

  const parsedStates = parseStates(statesJson);
  const statesInvalid = parsedStates === null;
  const dirty = systemPrompt !== initialPrompt || statesJson !== initialStates;
  const label = template.vertical.replace(/_/g, " ");

  function refresh() {
    return queryClient.invalidateQueries({ queryKey: ["admin", "template-detail"] });
  }

  /** PATCH by the row's uuid (the route's `where id =` lookup); the publish route compiles the STORED row, so edits must land first. */
  async function saveEdits(): Promise<boolean> {
    if (parsedStates === null) return false;
    const res = await fetch(`/api/admin/admin-templates/${template.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ system_prompt: systemPrompt, states: parsedStates }),
    });
    if (!res.ok) {
      toast.error(failureMessage("save", res.status, await errorCode(res)));
      return false;
    }
    return true;
  }

  async function saveDraft() {
    setBusy(true);
    const ok = await saveEdits();
    setBusy(false);
    if (ok) {
      toast.success("Draft saved. It is not live until you publish it.");
      await refresh();
    }
  }

  async function publish() {
    setBusy(true);
    try {
      if (dirty && !(await saveEdits())) return;
      const res = await fetch(`/api/admin/admin-templates/${template.id}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        toast.error(failureMessage("publish", res.status, await errorCode(res)));
        return;
      }
      setPublished((await res.json()) as PublishResult);
      toast.success(`Published ${label} v${template.version} to Retell`);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
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
              value={systemPrompt}
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
              aria-invalid={statesInvalid}
              value={statesJson}
              onChange={(e) => setStatesJson(e.target.value)}
            />
            {statesInvalid && (
              <p role="alert" className="text-xs text-destructive">
                States must be valid JSON and an array. Fix it before saving or publishing.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={saveDraft}
              disabled={busy || !dirty || statesInvalid}
            >
              Save draft
            </Button>
            <Button onClick={() => setConfirmOpen(true)} disabled={busy || statesInvalid}>
              Publish to Retell
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Publishing compiles this template, creates a new Retell agent and makes it the live
            template for every new {label} agent.
          </p>
        </CardContent>
      </Card>

      {published && (
        <Callout tone="success" title="Published to Retell">
          Agent {published.retell_agent_id} (flow {published.retell_flow_id}) is now the live{" "}
          {label} template.
        </Callout>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Publish {label} v{template.version} to Retell?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This is live: it creates a Retell agent and flips the active {label} template
              immediately.{dirty ? " Your unsaved edits are saved first." : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={publish}>Publish live</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Structured-form editor (FRONTEND_SPEC.md §7.4 DECIDE — a visual state-graph canvas is future scope; V1 ships JSON sub-fields for states). */
export function TemplateEditor({ vertical }: { vertical: string }) {
  const query = useAdminQuery<TemplateResponse>(
    "template-detail",
    [vertical],
    `admin-templates/${vertical}`,
  );
  const template = query.data?.template;

  return (
    <div className="space-y-6">
      <PageHeader
        title={template ? template.name : "Agent template"}
        description={
          template ? (
            <span className="flex items-center gap-2">
              <span className="capitalize">{template.vertical.replace(/_/g, " ")}</span>
              <span className="tabular-nums">v{template.version}</span>
              <Badge variant={template.is_active ? "success" : "outline"}>
                {template.is_active ? "Live" : "Draft"}
              </Badge>
            </span>
          ) : undefined
        }
      />
      <DataState
        query={query}
        empty={{ title: "No template for this vertical", isEmpty: (d) => !d?.template }}
        render={(data) => (
          // Keyed on the row so a newer version (or another vertical) remounts with fresh state.
          <EditorBody
            key={`${data.template.id}:${data.template.version}`}
            template={data.template}
          />
        )}
      />
    </div>
  );
}
