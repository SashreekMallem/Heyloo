import { NextResponse } from "next/server";
import {
  type BuiltInQuestions,
  builtInQuestionsFor,
  type CustomQuestion,
  newCustomQuestionId,
  readCustomQuestions,
} from "@/lib/settings/custom-questions";
import { readAgentConfigForPublish } from "@/lib/settings/publish-config";
import { agentAsksCustomQuestions } from "@/lib/settings/publish-status";
import {
  mergeOverrides,
  parseBody,
  requireTenantMember,
  requireTenantWriter,
  updateResult,
} from "@/lib/settings/route-auth";
import { customQuestionsRequestSchema } from "@/lib/settings/schemas";

export const runtime = "nodejs";

export interface QuestionsResponse {
  questions: CustomQuestion[];
  /** The vertical's built-in questions, read-only in the portal. */
  builtIn: BuiltInQuestions;
  vertical: string | null;
  /** False for a member: the page renders read-only. */
  canEdit: boolean;
  /** False until the published agent has been (re)published with a compiler that can ask custom questions. */
  agentAsksQuestions: boolean;
}

/**
 * `GET /api/tenant/agent/questions` (INTAKE-Q-1): the tenant's custom intake
 * questions plus what the AI already asks for its vertical, for the Agent →
 * Questions tab. Any signed-in member may read; `canEdit` tells the page
 * whether to render editable controls. Tenant comes from the JWT only.
 */
export async function GET() {
  const auth = await requireTenantMember();
  if (!auth.ok) return auth.response;

  const [configRead, tenantRes] = await Promise.all([
    readAgentConfigForPublish(auth.supabase, auth.tenantId),
    auth.supabase.from("tenants").select("vertical").eq("id", auth.tenantId).maybeSingle(),
  ]);
  if (!configRead.ok || tenantRes.error) {
    return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }
  const config = configRead.row;
  if (!config) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const vertical = typeof tenantRes.data?.vertical === "string" ? tenantRes.data.vertical : null;
  const body: QuestionsResponse = {
    questions: readCustomQuestions(config.dynamic_variable_overrides),
    builtIn: builtInQuestionsFor(vertical),
    vertical,
    canEdit: auth.canWrite,
    agentAsksQuestions: agentAsksCustomQuestions({
      publishedAt: config.published_at,
      compiledWithVersion: config.compiled_with_version,
    }),
  };
  return NextResponse.json(body);
}

/**
 * `POST /api/tenant/agent/questions` (INTAKE-Q-1): saves the whole list of
 * custom intake questions (owner/admin only, zod-validated per row: at most 10,
 * 200-character question, optional 100-character answer hint, `applies_to`,
 * required, active; wording that would read as an instruction to the AI is
 * rejected with a message). `position` is the array order; new questions get a
 * server-generated id. Stored at `agent_configs.dynamic_variable_overrides.
 * custom_questions` (an empty list removes the key); the database CHECK
 * (`agent_configs_custom_questions_valid`) is the last line of defense.
 * The response says whether the live agent will use the change on the next
 * call (`agentAsksQuestions`) or needs one publish first.
 */
export async function POST(request: Request) {
  const auth = await requireTenantWriter();
  if (!auth.ok) return auth.response;
  const body = await parseBody(request, customQuestionsRequestSchema);
  if (!body.ok) return body.response;

  const configRead = await readAgentConfigForPublish(auth.supabase, auth.tenantId);
  if (!configRead.ok) return NextResponse.json({ error: "read_failed" }, { status: 500 });
  const config = configRead.row;
  if (!config) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const used = new Set(body.data.questions.flatMap((q) => (q.id ? [q.id] : [])));
  const stored: CustomQuestion[] = body.data.questions.map((question, position) => {
    let id = question.id;
    if (!id) {
      do {
        id = newCustomQuestionId();
      } while (used.has(id));
      used.add(id);
    }
    return {
      id,
      label: question.label,
      ...(question.hint ? { hint: question.hint } : {}),
      required: question.required,
      applies_to: question.applies_to,
      position,
      active: question.active,
    };
  });

  const result = await auth.supabase
    .from("agent_configs")
    .update({
      dynamic_variable_overrides: mergeOverrides(config.dynamic_variable_overrides, {
        custom_questions: stored.length > 0 ? stored : null,
      }),
    })
    .eq("tenant_id", auth.tenantId)
    .select("id");
  const written = updateResult(result);
  if (!written.ok) return written.response;

  return NextResponse.json({
    ok: true,
    count: stored.length,
    questions: stored,
    agentAsksQuestions: agentAsksCustomQuestions({
      publishedAt: config.published_at,
      compiledWithVersion: config.compiled_with_version,
    }),
  });
}
