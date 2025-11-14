import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-vapi-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(supabaseUrl, supabaseServiceKey);
const VAPI_API_BASE = Deno.env.get("VAPI_API_BASE_URL") ?? "https://api.vapi.ai";
const VAPI_TOKEN = Deno.env.get("VAPI_API_KEY") ?? Deno.env.get("VAPI_SERVER_API_KEY") ?? Deno.env.get("VAPI_PRIVATE_KEY") ?? Deno.env.get("VAPI_TOOL_TOKEN") ?? null;
const FINAL_STATUSES = new Set([
  "completed",
  "failed",
  "ended"
]);
const TRACKABLE_MESSAGE_TYPES = new Set([
  "status-update",
  "conversation-update",
  "phone-call-control",
  "speech-update",
  "voice-input",
  "model-output",
  "tool-calls",
  "tool-calls-result",
  "transcript",
  "end-of-call-report"
]);
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
  } catch (_err) {
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
function normaliseStatus(status, fallback) {
  if (typeof status === "string" && status.trim().length > 0) {
    const normalised = status.trim().toLowerCase();
    if (normalised === "ended") return "completed";
    return normalised;
  }
  return fallback ?? null;
}
function deriveOutcome(status, endedReason) {
  if (status === "failed") return "error";
  if (status === "completed") {
    if (endedReason && endedReason.toLowerCase().includes("order")) return "order_placed";
    if (endedReason && endedReason.toLowerCase().includes("cancel")) return "cancelled";
    return "inquiry";
  }
  return null;
}
function extractStructuredOutputs(event, message, call) {
  return message?.artifact?.structuredOutputs ?? message?.artifact?.structured_outputs ?? call?.artifact?.structuredOutputs ?? call?.artifact?.structured_outputs ?? message?.structuredOutputs ?? message?.structured_outputs ?? call?.structuredOutputs ?? call?.structured_outputs ?? event?.structuredOutputs ?? event?.structured_outputs ?? null;
}
function extractTranscriptParts(message, call) {
  const transcript = {};
  if (message?.transcript) transcript.transcript = message.transcript;
  if (message?.conversation) transcript.conversation = message.conversation;
  if (message?.messages) transcript.messages = message.messages;
  if (message?.artifact?.messages) transcript.artifactMessages = message.artifact.messages;
  if (message?.artifact?.transcript) transcript.artifactTranscript = message.artifact.transcript;
  if (call?.transcript) transcript.callTranscript = call.transcript;
  if (call?.conversation) transcript.callConversation = call.conversation;
  if (call?.messages) transcript.callMessages = call.messages;
  return Object.keys(transcript).length > 0 ? transcript : null;
}
function extractCallContext(event) {
  const message = event?.message ?? {};
  const call = message?.call ?? event?.call ?? {};
  const assistant = event?.assistant ?? {};
  const variableValues = assistant?.variableValues ?? {};
  const callId = call?.id ?? message?.callId ?? event?.callId ?? event?.data?.callId ?? null;
  const restaurantId = variableValues?.restaurant_id ?? message?.restaurantId ?? event?.restaurantId ?? event?.data?.restaurantId ?? null;
  const locationId = variableValues?.location_id ?? call?.locationId ?? message?.locationId ?? event?.data?.locationId ?? null;
  const status = normaliseStatus(message?.status ?? call?.status ?? event?.data?.state ?? event?.status ?? event?.type === "end-of-call-report" ? "completed" : null, event?.type === "end-of-call-report" ? "completed" : undefined);
  const durationSeconds = toNumber(call?.durationSeconds ?? call?.duration ?? call?.metrics?.durationSeconds ?? message?.durationSeconds ?? message?.duration ?? message?.metrics?.durationSeconds ?? event?.data?.durationSeconds ?? event?.data?.duration ?? event?.metadata?.durationSeconds ?? event?.metrics?.durationSeconds ?? null) ?? null;
  const costsCandidate = message?.costs ?? message?.artifact?.costs ?? call?.costs ?? call?.cost ?? call?.metadata?.costs ?? event?.costs ?? event?.data?.cost ?? event?.metadata?.costs ?? null;
  const cost = costsCandidate ? toNumber(costsCandidate.total ?? costsCandidate.totalUsd ?? costsCandidate.totalUSD ?? costsCandidate.grandTotal ?? costsCandidate.amount ?? costsCandidate.value ?? null) : toNumber(message?.cost ?? call?.cost ?? event?.cost ?? null);
  const callTypeRaw = call?.type ?? message?.callType ?? event?.callType ?? null;
  const callType = normalizeCallType(callTypeRaw);
  const customerPhone = call?.customer?.number ?? call?.customerNumber ?? call?.customer_phone ?? message?.customerPhone ?? message?.customer_number ?? event?.customer?.number ?? event?.data?.phoneNumber ?? event?.data?.customerNumber ?? null;
  const endedReason = message?.endedReason ?? call?.endedReason ?? event?.endedReason ?? event?.data?.endedReason ?? null;
  const baseSummary = message?.summary ?? message?.artifact?.summary ?? call?.summary ?? event?.summary ?? event?.report?.summary ?? null;
  const analysis = message?.analysis ?? call?.analysis ?? event?.analysis ?? event?.report ?? null;
  const summary = baseSummary ?? analysis?.summary ?? analysis?.report?.summary ?? null;
  const successEvaluation = toBoolean(analysis?.successEvaluation ?? analysis?.success ?? analysis?.passed ?? analysis?.qaPass ?? analysis?.qaResult ?? event?.successEvaluation ?? event?.qaResult ?? event?.evaluation?.success ?? null);
  const assistantId = assistant?.id ?? call?.assistantId ?? call?.assistant?.id ?? message?.assistantId ?? analysis?.assistantId ?? null;
  const phoneNumberId = call?.phoneNumberId ?? call?.phoneNumber?.id ?? message?.phoneNumberId ?? message?.phoneNumber?.id ?? event?.phoneNumberId ?? event?.data?.phoneNumberId ?? null;
  const structuredOutputs = extractStructuredOutputs(event, message, call);
  const transcriptParts = extractTranscriptParts(message, call);
  const createdAt = toIsoTimestamp(call?.createdAt ?? message?.call?.createdAt ?? event?.createdAt) ?? toIsoTimestamp(message?.timestamp ?? message?.time ?? event?.timestamp) ?? null;
  const updatedAt = toIsoTimestamp(call?.updatedAt ?? message?.call?.updatedAt ?? event?.updatedAt) ?? toIsoTimestamp(event?.timestamp ?? message?.timestamp ?? message?.time) ?? createdAt ?? null;
  const startedAt = toIsoTimestamp(call?.startedAt ?? message?.startedAt ?? event?.startedAt ?? event?.data?.startedAt);
  const endedAt = toIsoTimestamp(call?.endedAt ?? message?.endedAt ?? event?.endedAt ?? event?.data?.endedAt);
  return {
    callId,
    restaurantId,
    locationId,
    status,
    durationSeconds,
    customerPhone,
    endedReason,
    summary,
    cost,
    callType,
    transcriptParts,
    assistantId,
    phoneNumberId,
    structuredOutputs,
    successEvaluation,
    message,
    call,
    assistant,
    variableValues,
    createdAt,
    updatedAt,
    startedAt,
    endedAt
  };
}
async function fetchVapiCallDetails(callId) {
  if (!VAPI_TOKEN || !callId) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(), 8000);
    const response = await fetch(`${VAPI_API_BASE.replace(/\/$/, "")}/call/${callId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${VAPI_TOKEN}`,
        Accept: "application/json"
      },
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!response.ok) {
      console.warn(`Vapi call lookup failed for ${callId}: ${response.status}`);
      return null;
    }
    const payload = await response.json();
    return payload?.call ?? payload;
  } catch (error) {
    console.error("Failed to fetch Vapi call details", {
      callId,
      error
    });
    return null;
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
async function upsertCallLog(event) {
  try {
    const ctx = extractCallContext(event);
    const eventType = event?.type ?? ctx.message?.type ?? "unknown";
    if (!ctx.callId || !ctx.restaurantId) {
      console.error("VAPI event missing identifiers", {
        eventType,
        callId: ctx.callId,
        restaurantId: ctx.restaurantId
      });
      return;
    }
    let locationId = ctx.locationId;
    if (!locationId && event?.data?.phoneNumberId) {
      const { data: location } = await supabase.from("restaurant_pos_locations").select("id").eq("vapi_phone_number", event.data.phoneNumberId).eq("is_active", true).maybeSingle();
      if (location) locationId = location.id;
    }
    const outcome = deriveOutcome(ctx.status, ctx.endedReason);
    const record = {
      call_id: ctx.callId,
      restaurant_id: ctx.restaurantId,
      status: ctx.status ?? "in_progress",
      event_type: eventType,
      customer_phone: ctx.customerPhone ?? null,
      duration_seconds: ctx.durationSeconds ?? null,
      call_type: ctx.callType ?? null,
      outcome,
      summary: ctx.summary ?? null,
      ended_reason: ctx.endedReason ?? null,
      cost: ctx.cost ?? null,
      assistant_id: ctx.assistantId ?? null,
      phone_number_id: ctx.phoneNumberId ?? null,
      structured_outputs: ctx.structuredOutputs ?? null,
      success_evaluation: ctx.successEvaluation ?? null,
      transcript: ctx.transcriptParts ?? null,
      created_at: ctx.createdAt ?? null,
      updated_at: ctx.updatedAt ?? new Date().toISOString(),
      started_at: ctx.startedAt ?? null,
      ended_at: ctx.endedAt ?? null
    };
    if (locationId) record.location_id = locationId;
    // Always enrich for completed/ended calls, or if key fields are missing
    const isFinalStatus = ctx.status && FINAL_STATUSES.has(ctx.status);
    const needsEnrichment = isFinalStatus || !record.summary || record.cost == null || !record.assistant_id || !record.phone_number_id || !record.started_at || !record.ended_at;
    if (needsEnrichment && VAPI_TOKEN) {
      console.log(`Enriching call ${ctx.callId} from VAPI API...`);
      const detail = await fetchVapiCallDetails(ctx.callId);
      if (detail) {
        mergeCallDetails(record, detail);
        console.log(`Enriched call ${ctx.callId}: duration=${record.duration_seconds}, cost=${record.cost}, summary=${!!record.summary}`);
      } else {
        console.warn(`Failed to fetch details for call ${ctx.callId}`);
      }
    }
    if (!record.created_at) {
      record.created_at = new Date().toISOString();
    }
    record.updated_at = new Date().toISOString();
    const { error } = await supabase.from("call_logs").upsert(record, {
      onConflict: "call_id"
    });
    if (error) throw new Error(`Failed to upsert call log: ${error.message}`);
    const normalisedStatus = ctx.status ?? null;
    if (normalisedStatus && FINAL_STATUSES.has(normalisedStatus)) {
      await supabase.rpc("record_call_usage", {
        p_restaurant_id: ctx.restaurantId,
        p_call_duration_seconds: record.duration_seconds ?? 0,
        p_outcome: normalisedStatus
      });
    }
  } catch (error) {
    console.error("Failed to upsert call log:", error, {
      event
    });
  }
}
async function handleFunctionCall(event) {
  try {
    const { message } = event;
    if (!message) return;
    const { toolCalls, call } = message;
    if (!toolCalls || !Array.isArray(toolCalls)) return;
    for (const toolCall of toolCalls){
      if (toolCall?.function?.name === "create_order" && toolCall?.result) {
        const orderId = toolCall.result?.id;
        const callId = call?.id;
        if (orderId && callId) {
          await supabase.from("orders").update({
            call_id: callId
          }).eq("id", orderId);
        }
      }
    }
  } catch (error) {
    console.error("Failed to handle function-call webhook:", error);
  }
}
async function handleEndOfCallReport(event) {
  try {
    await upsertCallLog(event);
  } catch (error) {
    console.error("Failed to handle end-of-call-report webhook:", error);
  }
}
async function verifyVapiSignature(rawBody, signature) {
  if (!signature) return false;
  const webhookSecret = Deno.env.get("VAPI_WEBHOOK_SECRET");
  if (!webhookSecret) return false;
  const incomingSignature = signature.toLowerCase();
  const encoder = new TextEncoder();
  const keyData = encoder.encode(webhookSecret);
  const messageData = encoder.encode(rawBody);
  const key = await crypto.subtle.importKey("raw", keyData, {
    name: "HMAC",
    hash: "SHA-256"
  }, false, [
    "sign"
  ]);
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, messageData);
  const expectedSignature = Array.from(new Uint8Array(signatureBuffer)).map((b)=>b.toString(16).padStart(2, "0")).join("");
  if (incomingSignature.length !== expectedSignature.length) return false;
  let result = 0;
  for(let i = 0; i < incomingSignature.length; i += 1){
    result |= incomingSignature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
  }
  return result === 0;
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-vapi-signature");
    if (!rawBody) {
      return new Response(JSON.stringify({
        message: "Raw body is required for signature verification",
        code: "INVALID_PAYLOAD"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const isValid = await verifyVapiSignature(rawBody, signature);
    if (!isValid) {
      return new Response(JSON.stringify({
        message: "Invalid VAPI signature",
        code: "UNAUTHORIZED"
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const event = JSON.parse(rawBody);
    const eventType = event?.type ?? null;
    const messageType = event?.message?.type ?? null;
    switch(eventType){
      case "call.created":
      case "call.updated":
      case "call.ended":
        await upsertCallLog(event);
        break;
      case "function-call":
        await handleFunctionCall(event);
        break;
      case "end-of-call-report":
        await handleEndOfCallReport(event);
        break;
      case "assistant-request":
        break;
      default:
        if (messageType && TRACKABLE_MESSAGE_TYPES.has(messageType)) {
          await upsertCallLog(event);
        } else {
          console.log(`Received event type: ${eventType ?? "unknown"} (${messageType ?? "no message type"})`);
        }
    }
    return new Response(JSON.stringify({
      received: true
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Error in vapi-events:", error);
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
