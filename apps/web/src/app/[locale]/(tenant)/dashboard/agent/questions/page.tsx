"use client";

import {
  Badge,
  Button,
  Callout,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@heyloo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { QuestionsResponse } from "@/app/api/tenant/agent/questions/route";
import {
  SAVED_NEXT_CALL,
  SAVED_QUESTIONS_NEED_PUBLISH,
  saveErrorMessage,
  sendJson,
} from "@/lib/settings/client";
import {
  CUSTOM_QUESTION_APPLIES_TO,
  CUSTOM_QUESTION_APPLIES_TO_LABEL,
  CUSTOM_QUESTION_HINT_MAX_CHARS,
  CUSTOM_QUESTION_LABEL_MAX_CHARS,
  CUSTOM_QUESTIONS_MAX,
  type CustomQuestion,
  type CustomQuestionAppliesTo,
} from "@/lib/settings/custom-questions";
import { customQuestionsRequestSchema } from "@/lib/settings/schemas";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

interface Row {
  /** Stable React key; not sent to the server. */
  key: string;
  /** Present for a question that was already saved. */
  id?: string;
  label: string;
  hint: string;
  required: boolean;
  applies_to: CustomQuestionAppliesTo;
  active: boolean;
}

/** Stable React keys for editor rows (never sent to the server). */
let rowKeyCounter = 0;
function nextKey(): string {
  rowKeyCounter += 1;
  return `row-${rowKeyCounter}`;
}

function rowsFrom(questions: CustomQuestion[]): Row[] {
  return questions.map((q) => ({
    key: nextKey(),
    id: q.id,
    label: q.label,
    hint: q.hint ?? "",
    required: q.required,
    applies_to: q.applies_to,
    active: q.active,
  }));
}

/**
 * Agent → Questions (INTAKE-Q-1): what the AI already asks for this business
 * type (read-only) and the owner's own extra questions (add, edit, reorder,
 * remove; required; applies to bookings, messages or both). Saved through
 * `POST /api/tenant/agent/questions`; the AI reads the list at call time, so an
 * edit is live on the next call once the agent has been published with a
 * compiler that supports it (`agentAsksQuestions`), and the page says so when
 * it hasn't. A member sees everything read-only.
 */
export default function QuestionsTabPage() {
  const tenantId = useCurrentTenantId();
  const query = useQuery({
    queryKey: ["tenant", tenantId, "agent_configs", "questions"],
    queryFn: async (): Promise<QuestionsResponse | null> => {
      const res = await fetch("/api/tenant/agent/questions");
      if (!res.ok) return null;
      return (await res.json()) as QuestionsResponse;
    },
    enabled: !!tenantId,
  });

  if (!tenantId || query.data === undefined) return null;
  if (query.data === null) {
    return (
      <p className="text-sm text-destructive" role="alert">
        Couldn&apos;t load your questions — please refresh.
      </p>
    );
  }
  return <QuestionsForm tenantId={tenantId} data={query.data} />;
}

function QuestionsForm({ tenantId, data }: { tenantId: string; data: QuestionsResponse }) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Row[]>(() => rowsFrom(data.questions));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [agentAsks, setAgentAsks] = useState(data.agentAsksQuestions);
  const canEdit = data.canEdit;

  function update(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }
  function move(index: number, delta: -1 | 1) {
    setRows((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved as Row);
      return next;
    });
  }

  async function save() {
    setFormError(null);
    // Fully blank rows are dropped rather than rejected.
    const kept = rows.filter((row) => row.label.trim() || row.hint.trim());
    const payload = {
      questions: kept.map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        label: row.label,
        hint: row.hint,
        required: row.required,
        applies_to: row.applies_to,
        active: row.active,
      })),
    };
    const parsed = customQuestionsRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      let general: string | null = null;
      for (const issue of parsed.error.issues) {
        const index = issue.path[1];
        const row = typeof index === "number" ? kept[index] : undefined;
        if (row) next[`${row.key}:${String(issue.path[2] ?? "label")}`] = issue.message;
        else general = issue.message;
      }
      setErrors(next);
      setFormError(
        general ?? (Object.keys(next).length > 0 ? "Please fix the highlighted questions." : null),
      );
      return;
    }
    setErrors({});
    setSaving(true);
    const result = await sendJson<{ questions?: CustomQuestion[]; agentAsksQuestions?: boolean }>(
      "/api/tenant/agent/questions",
      payload,
    );
    setSaving(false);
    if (!result.ok) {
      toast.error(saveErrorMessage(result));
      return;
    }
    const saved = result.body?.questions ?? [];
    setRows(rowsFrom(saved));
    const asks = result.body?.agentAsksQuestions ?? agentAsks;
    setAgentAsks(asks);
    toast.success(asks ? SAVED_NEXT_CALL : SAVED_QUESTIONS_NEED_PUBLISH);
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "agent_configs"] });
  }

  const atLimit = rows.length >= CUSTOM_QUESTIONS_MAX;

  return (
    <div className="space-y-6">
      {!agentAsks && (
        <Callout tone="warning" title="Publish once to turn this on">
          Your live agent was published before custom questions existed, so it won&apos;t ask these
          yet. Save your questions, then click <strong>Publish changes</strong> above — after that,
          every edit here is live on the next call with no further publish.
        </Callout>
      )}

      <Card>
        <CardHeader>
          <CardTitle>What your AI already asks</CardTitle>
          <CardDescription>
            These come with your business type and can&apos;t be edited. Your own questions below
            are asked after these, before your AI reads everything back to the caller.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <BuiltInList
            title="When booking"
            items={data.builtIn.booking}
            emptyText="This business type takes messages instead of bookings."
          />
          <BuiltInList
            title="When taking a message"
            items={data.builtIn.message}
            emptyText="Nothing extra."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your custom questions</CardTitle>
          <CardDescription>
            Extra questions your AI asks every caller who books or leaves a message, one at a time,
            in your words. On a call in another language it translates the question faithfully, and
            it never changes what you asked. Answers are saved with the booking or message, shown on
            the call and booking pages, and included in your alerts. Up to {CUSTOM_QUESTIONS_MAX}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canEdit && (
            <p className="text-sm text-muted-foreground" role="status">
              Only an owner or admin can change these questions.
            </p>
          )}

          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No custom questions yet. Add one, like &ldquo;How did you hear about us?&rdquo; or
              &ldquo;Is there a gate code we&apos;ll need?&rdquo;
            </p>
          )}

          <ol className="space-y-3">
            {rows.map((row, index) => {
              const n = index + 1;
              const labelError = errors[`${row.key}:label`];
              const hintError = errors[`${row.key}:hint`];
              return (
                <li key={row.key} className="space-y-3 rounded-md border border-border p-3">
                  <div className="flex items-start gap-2">
                    <span className="mt-2 w-5 shrink-0 text-sm text-muted-foreground">{n}.</span>
                    <div className="min-w-0 flex-1 space-y-2">
                      <Input
                        placeholder="What should your AI ask?"
                        aria-label={`Question ${n}`}
                        aria-invalid={labelError ? true : undefined}
                        value={row.label}
                        maxLength={CUSTOM_QUESTION_LABEL_MAX_CHARS + 50}
                        disabled={!canEdit}
                        onChange={(e) => update(row.key, { label: e.target.value })}
                      />
                      {labelError && (
                        <p className="text-sm text-destructive" role="alert">
                          {labelError}
                        </p>
                      )}
                      <Input
                        placeholder="Optional: what a good answer looks like, e.g. a make and model"
                        aria-label={`Answer hint ${n}`}
                        aria-invalid={hintError ? true : undefined}
                        value={row.hint}
                        maxLength={CUSTOM_QUESTION_HINT_MAX_CHARS + 50}
                        disabled={!canEdit}
                        onChange={(e) => update(row.key, { hint: e.target.value })}
                      />
                      {hintError && (
                        <p className="text-sm text-destructive" role="alert">
                          {hintError}
                        </p>
                      )}
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 items-center">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`Move question ${n} up`}
                          disabled={index === 0}
                          onClick={() => move(index, -1)}
                        >
                          <ArrowUp className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`Move question ${n} down`}
                          disabled={index === rows.length - 1}
                          onClick={() => move(index, 1)}
                        >
                          <ArrowDown className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`Remove question ${n}`}
                          onClick={() => setRows((cur) => cur.filter((r) => r.key !== row.key))}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pl-7">
                    <div className="flex items-center gap-2 text-sm">
                      <Switch
                        checked={row.required}
                        disabled={!canEdit}
                        aria-label={`Required ${n}`}
                        onCheckedChange={(checked) => update(row.key, { required: checked })}
                      />
                      <span aria-hidden="true">Required</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Switch
                        checked={row.active}
                        disabled={!canEdit}
                        aria-label={`Active ${n}`}
                        onCheckedChange={(checked) => update(row.key, { active: checked })}
                      />
                      <span aria-hidden="true">Active</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">Ask for</span>
                      <Select
                        value={row.applies_to}
                        disabled={!canEdit}
                        onValueChange={(value) =>
                          update(row.key, { applies_to: value as CustomQuestionAppliesTo })
                        }
                      >
                        <SelectTrigger className="w-52" aria-label={`Ask for ${n}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CUSTOM_QUESTION_APPLIES_TO.map((value) => (
                            <SelectItem key={value} value={value}>
                              {CUSTOM_QUESTION_APPLIES_TO_LABEL[value]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {row.required && (
                      <Badge variant="warning">
                        Asked until answered (a caller who refuses is recorded as declined)
                      </Badge>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          {formError && (
            <p className="text-sm text-destructive" role="alert">
              {formError}
            </p>
          )}

          {canEdit && (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={atLimit}
                onClick={() =>
                  setRows((cur) => [
                    ...cur,
                    {
                      key: nextKey(),
                      label: "",
                      hint: "",
                      required: false,
                      applies_to: "both",
                      active: true,
                    },
                  ])
                }
              >
                <Plus className="size-3.5" /> Add question
              </Button>
              <span className="text-xs text-muted-foreground">
                {rows.length} of {CUSTOM_QUESTIONS_MAX}
              </span>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Use required sparingly: your AI asks a required question twice, then records the
            caller&apos;s refusal as &ldquo;Declined to answer&rdquo; so the booking or message
            isn&apos;t lost. Turn a question off with Active to keep it without asking it.
          </p>

          {canEdit && (
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BuiltInList({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: QuestionsResponse["builtIn"]["booking"];
  emptyText: string;
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium">{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {items.map((item) => (
            <li key={item.paths.join("+")}>{item.label}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
