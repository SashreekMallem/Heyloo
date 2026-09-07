import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-backfill-token, x-internal-call",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(supabaseUrl, supabaseServiceKey);
const ADMIN_TOKEN = Deno.env.get("BACKFILL_TASK_TOKEN") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const VAPI_API_BASE = Deno.env.get("VAPI_API_BASE_URL") ?? "https://api.vapi.ai";
const VAPI_TOKEN = Deno.env.get("VAPI_API_KEY") ?? Deno.env.get("VAPI_SERVER_API_KEY") ?? Deno.env.get("VAPI_PRIVATE_KEY") ?? Deno.env.get("VAPI_TOOL_TOKEN") ?? null;
function unauthorizedResponse() {
  return new Response(JSON.stringify({
    message: "Unauthorized"
  }), {
    status: 401,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
function normalizeCallType(callType) {
  if (!callType || typeof callType !== "string") return null;
  const normalized = callType.toLowerCase().trim();
  if (normalized.includes("inbound")) return "inbound";
  if (normalized.includes("outbound")) return "outbound";
  return null;
}
function toNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "bigint") return Number(value);
  try {
    const parsed = Number(value?.valueOf?.());
    return Number.isFinite(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}
function toBoolean(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : null;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if ([
      "true",
      "yes",
      "pass",
      "passed",
      "success",
      "successful"
    ].includes(normalized)) {
      return true;
    }
    if ([
      "false",
      "no",
      "fail",
      "failed",
      "error",
      "unsuccessful"
    ].includes(normalized)) {
      return false;
    }
  }
  return null;
}
function toIsoTimestamp(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const date = new Date(trimmed);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  if (typeof value === "number") {
    const millis = value > 1e12 ? value : value * 1000;
    const date = new Date(millis);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return null;
}
function calculateDuration(startedAt, endedAt) {
  if (!startedAt || !endedAt) return null;
  const start = new Date(startedAt);
  const end = new Date(endedAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const diffMs = end.getTime() - start.getTime();
  if (diffMs < 0) return null;
  return Math.round(diffMs / 1000);
}
async function fetchVapiCallDetails(callId) {
  if (!VAPI_TOKEN || !callId) {
    console.warn(`Cannot fetch VAPI details: token=${!!VAPI_TOKEN}, callId=${!!callId}`);
    return {
      detail: null,
      status: "token-missing",
      error: `Token: ${VAPI_TOKEN ? "present" : "missing"}`
    };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(), 10000);
    const url = `${VAPI_API_BASE.replace(/\/$/, "")}/call/${callId}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${VAPI_TOKEN}`,
        Accept: "application/json"
      },
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!response.ok) {
      const errorText = await response.text().catch(()=>"");
      console.warn(`Vapi call lookup failed for ${callId}: ${response.status}`, errorText.substring(0, 200));
      return {
        detail: null,
        status: `error-${response.status}`,
        error: errorText.substring(0, 200)
      };
    }
    const payload = await response.json();
    return {
      detail: payload?.call ?? payload ?? null,
      status: "ok"
    };
  } catch (error) {
    const errorMsg = error?.message ?? String(error);
    console.error("Failed to fetch Vapi call details", {
      callId,
      error: errorMsg,
      errorType: error?.name
    });
    return {
      detail: null,
      status: "exception",
      error: errorMsg
    };
  }
}
function mergeCallDetails(record, detail) {
  if (!detail || typeof detail !== "object") return;
  const artifact = detail.artifact ?? {};
  const analysis = detail.analysis ?? artifact.analysis ?? {};
  const costBreakdown = detail.costBreakdown ?? {};
  const costs = detail.costs ?? [];
  // Calculate duration from startedAt/endedAt if not provided
  if (record.duration_seconds == null) {
    const durationFromApi = toNumber(detail.durationSeconds ?? detail.duration ?? detail.metrics?.durationSeconds);
    if (durationFromApi != null) {
      record.duration_seconds = durationFromApi;
    } else {
      // Calculate from timestamps
      const startedAt = detail.startedAt ?? record.started_at;
      const endedAt = detail.endedAt ?? record.ended_at;
      if (startedAt && endedAt) {
        const calculated = calculateDuration(startedAt, endedAt);
        if (calculated != null) record.duration_seconds = calculated;
      }
    }
  }
  if (record.cost == null) {
    record.cost = toNumber(costBreakdown.total ?? detail.cost) ?? record.cost ?? null;
  }
  if (!record.summary) {
    record.summary = detail.summary ?? analysis.summary ?? null;
  }
  if (!record.ended_reason) {
    const endedReason = detail.endedReason ?? null;
    if (endedReason) record.ended_reason = endedReason;
  }
  if (!record.assistant_id) {
    record.assistant_id = detail.assistantId ?? detail.assistant?.id ?? null;
  }
  if (!record.phone_number_id) {
    record.phone_number_id = detail.phoneNumberId ?? detail.phoneNumber?.id ?? null;
  }
  if (record.customer_phone == null) {
    record.customer_phone = detail.customer?.number ?? detail.customerNumber ?? null;
  }
  if (!record.call_type && detail.type) {
    record.call_type = normalizeCallType(detail.type);
  }
  if (!record.structured_outputs && artifact.structuredOutputs) {
    record.structured_outputs = artifact.structuredOutputs;
  }
  if (!record.transcript) {
    const transcript = detail.transcript ?? artifact.transcript ?? null;
    if (transcript) {
      record.transcript = typeof transcript === "string" ? {
        text: transcript
      } : transcript;
    }
  }
  if (record.success_evaluation == null) {
    const success = toBoolean(analysis.successEvaluation ?? analysis.success ?? null) ?? null;
    if (success !== null) record.success_evaluation = success;
  }
  if (record.created_at == null) {
    const createdAt = toIsoTimestamp(detail.createdAt ?? detail.startedAt) ?? null;
    if (createdAt) record.created_at = createdAt;
  }
  if (!record.started_at) {
    const startedAt = toIsoTimestamp(detail.startedAt ?? detail.startTime) ?? null;
    if (startedAt) record.started_at = startedAt;
  }
  if (!record.ended_at) {
    const endedAt = toIsoTimestamp(detail.endedAt ?? detail.endTime) ?? null;
    if (endedAt) record.ended_at = endedAt;
  }
  const updatedAt = toIsoTimestamp(detail.updatedAt ?? detail.finishedAt) ?? record.created_at ?? null;
  if (updatedAt) record.updated_at = updatedAt;
  // Comprehensive fields from artifact
  if (!record.recording_url && (detail.recordingUrl ?? artifact.recordingUrl)) {
    record.recording_url = detail.recordingUrl ?? artifact.recordingUrl ?? null;
  }
  if (!record.stereo_recording_url && (detail.stereoRecordingUrl ?? artifact.stereoRecordingUrl)) {
    record.stereo_recording_url = detail.stereoRecordingUrl ?? artifact.stereoRecordingUrl ?? null;
  }
  if (!record.log_url && artifact.logUrl) {
    record.log_url = artifact.logUrl ?? null;
  }
  if (!record.pcap_url && artifact.pcapUrl) {
    record.pcap_url = artifact.pcapUrl ?? null;
  }
  if (!record.messages && (detail.messages ?? artifact.messages)) {
    record.messages = detail.messages ?? artifact.messages ?? null;
  }
  if (!record.messages_openai && artifact.messagesOpenAIFormatted) {
    record.messages_openai = artifact.messagesOpenAIFormatted ?? null;
  }
  if (!record.variable_values && artifact.variableValues) {
    record.variable_values = artifact.variableValues ?? null;
  }
  if (!record.nodes && artifact.nodes) {
    record.nodes = artifact.nodes ?? null;
  }
  if (!record.analysis && analysis) {
    record.analysis = analysis;
  }
  if (!record.artifact && artifact) {
    record.artifact = artifact;
  }
  if (!record.cost_breakdown && costBreakdown) {
    record.cost_breakdown = costBreakdown;
  }
  if (!record.cost_items && costs && costs.length > 0) {
    record.cost_items = costs;
  }
}
async function backfill(call) {
  const record = {
    duration_seconds: call.duration_seconds,
    summary: call.summary,
    ended_reason: call.ended_reason,
    cost: call.cost,
    structured_outputs: call.structured_outputs,
    success_evaluation: call.success_evaluation,
    transcript: call.transcript,
    assistant_id: call.assistant_id,
    phone_number_id: call.phone_number_id,
    customer_phone: call.customer_phone,
    call_type: call.call_type ? normalizeCallType(call.call_type) : null,
    started_at: call.started_at,
    ended_at: call.ended_at,
    updated_at: new Date().toISOString()
  };
  const { detail, status, error } = await fetchVapiCallDetails(call.call_id);
  if (detail) {
    mergeCallDetails(record, detail);
  }
  const hasChanges = record.duration_seconds !== call.duration_seconds || record.summary !== call.summary || record.structured_outputs !== call.structured_outputs || record.transcript !== call.transcript || record.assistant_id !== call.assistant_id || record.phone_number_id !== call.phone_number_id || record.cost !== call.cost || record.success_evaluation !== call.success_evaluation || record.call_type !== call.call_type || record.started_at !== call.started_at || record.ended_at !== call.ended_at || record.recording_url !== call.recording_url || record.messages !== call.messages || record.cost_breakdown !== call.cost_breakdown;
  if (!hasChanges) {
    return {
      updated: false,
      fetched: !!detail,
      fetchStatus: status,
      error
    };
  }
  const { error: dbError } = await supabase.from("call_logs").update(record).eq("id", call.id);
  if (dbError) throw new Error(`Failed to update call ${call.call_id}: ${dbError.message}`);
  return {
    updated: true,
    fetched: !!detail,
    fetchStatus: status,
    error
  };
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({
      message: "Method not allowed"
    }), {
      status: 405,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  // Allow internal calls from cron jobs without authentication
  // Check for internal call header or if called from same origin
  const isInternalCall = req.headers.get("x-internal-call") === "true";
  const token = req.headers.get("x-backfill-token");
  // For internal calls, skip auth check
  if (!isInternalCall && (!token || token !== ADMIN_TOKEN)) {
    console.warn("Unauthorized backfill attempt", {
      hasToken: !!token,
      hasInternalHeader: isInternalCall,
      userAgent: req.headers.get("user-agent")
    });
    return unauthorizedResponse();
  }
  try {
    const body = await req.json().catch(()=>({}));
    const limit = Math.max(1, Math.min(Number(body?.limit) || 25, 200));
    const callIds = Array.isArray(body?.callIds) ? body.callIds : undefined;
    const restaurantId = body?.restaurantId;
    let query = supabase.from("call_logs").select("id,call_id,restaurant_id,duration_seconds,summary,ended_reason,outcome,cost,structured_outputs,success_evaluation,transcript,assistant_id,phone_number_id,customer_phone,call_type,started_at,ended_at,recording_url,messages,cost_breakdown,created_at").order("created_at", {
      ascending: false
    });
    if (callIds && callIds.length > 0) {
      query = query.in("call_id", callIds);
    } else {
      const missingFilters = [
        "duration_seconds.is.null",
        "summary.is.null",
        "cost.is.null",
        "assistant_id.is.null",
        "phone_number_id.is.null",
        "messages.is.null",
        "cost_breakdown.is.null",
        "started_at.is.null",
        "ended_at.is.null"
      ];
      query = query.or(missingFilters.join(","));
      if (restaurantId) {
        query = query.eq("restaurant_id", restaurantId);
      }
      query = query.limit(limit);
    }
    const { data: calls, error } = await query;
    if (error) throw error;
    if (!calls || calls.length === 0) {
      return new Response(JSON.stringify({
        message: "No calls require backfill",
        processed: 0
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    console.log(`Processing ${calls.length} calls for backfill`);
    const results = [];
    for (const call of calls){
      try {
        const outcome = await backfill(call);
        results.push({
          callId: call.call_id,
          updated: outcome.updated,
          fetched: outcome.fetched,
          fetchStatus: outcome.fetchStatus,
          error: outcome.error
        });
      } catch (err) {
        console.error("Failed to backfill call", {
          callId: call.call_id,
          error: err
        });
        results.push({
          callId: call.call_id,
          updated: false,
          fetched: false,
          fetchStatus: "exception",
          error: err?.message ?? String(err)
        });
      }
    }
    return new Response(JSON.stringify({
      message: "Backfill complete",
      processed: results.length,
      updated: results.filter((r)=>r.updated).length,
      fetched: results.filter((r)=>r.fetched).length,
      results
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Error in vapi-backfill:", error);
    return new Response(JSON.stringify({
      error: "Internal server error",
      message: error?.message ?? "Unknown error"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
