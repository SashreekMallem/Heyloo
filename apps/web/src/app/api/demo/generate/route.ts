import { demoRequestSchema } from "@heyloo/canonical-types";
import { NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/edge-functions";

export const runtime = "nodejs";

interface CreateDemoResponse {
  demo_session_id: string;
  needs_confirmation: true;
  agent_summary: { business_name: string; hours_detected: string; services_detected: string[] };
  error?: string;
}

/**
 * `/demo` step 1 → `POST /api/demo/generate` (FRONTEND_SPEC.md §3.4). The
 * scrape/sanitize/LLM-extraction step happens synchronously inside
 * `api-demo-agent` (BACKEND_SPEC §7.8) — there is no separate
 * queued/polled status endpoint in the actual backend contract, so this
 * route awaits the full response rather than kicking off a background job
 * (see docs/BUILD_NOTES.md T5 entry: adapted from FRONTEND_SPEC's assumed
 * async-polling shape to the real synchronous one).
 */
export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = demoRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const { status, body } = await callEdgeFunction<CreateDemoResponse>("api-demo-agent", {
    method: "POST",
    body: {
      business_name: parsed.data.business_name,
      url: parsed.data.website_url,
    },
  });

  return NextResponse.json(body, { status });
}
