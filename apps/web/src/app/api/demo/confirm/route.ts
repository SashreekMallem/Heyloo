import { NextResponse } from "next/server";
import { z } from "zod";
import { callEdgeFunction } from "@/lib/edge-functions";

export const runtime = "nodejs";

const confirmSchema = z.object({
  demo_session_id: z.string().min(1),
  edits: z
    .object({
      business_name: z.string().optional(),
      hours_detected: z.string().optional(),
      services_detected: z.array(z.string()).optional(),
    })
    .optional(),
});

interface ConfirmDemoResponse {
  demo_session_id: string;
  retell_call_token: string;
  demo_phone_e164: string;
  agent_summary: { business_name: string; hours_detected: string; services_detected: string[] };
  error?: string;
}

/**
 * `/demo` step 3 confirm → mints the Retell web-call token server-side
 * (FRONTEND_SPEC.md §3.4/§4 — "Retell secret never reaches the browser").
 * Distinct from `/api/demo/generate`: the edge function discriminates
 * create-vs-confirm by request shape (`confirmed: true` present).
 */
export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = confirmSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const { status, body } = await callEdgeFunction<ConfirmDemoResponse>("api-demo-agent", {
    method: "POST",
    body: { ...parsed.data, confirmed: true },
  });

  return NextResponse.json(body, { status });
}
