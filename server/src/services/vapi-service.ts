import crypto from 'node:crypto';

import type { VapiCallEvent } from '@heyloo/shared';
import { vapiCallEventSchema } from '@heyloo/shared';

import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { supabase } from '../lib/supabase.js';

export function verifyVapiSignature(rawBody: string, signature?: string | string[]) {
  if (!signature) {
    throw Object.assign(new Error('Missing VAPI signature header'), {
      status: 401,
      code: 'UNAUTHORIZED'
    });
  }

  const sig = Array.isArray(signature) ? signature[0] : signature;
  const expected = crypto
    .createHmac('sha256', env.VAPI_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  const providedBuffer = Buffer.from(sig);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    throw Object.assign(new Error('Invalid VAPI signature'), {
      status: 401,
      code: 'UNAUTHORIZED'
    });
  }

  if (!crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    throw Object.assign(new Error('Invalid VAPI signature'), {
      status: 401,
      code: 'UNAUTHORIZED'
    });
  }
}

export async function handleVapiEvent(eventPayload: unknown) {
  // Try to parse as standard call event first
  const parseResult = vapiCallEventSchema.safeParse(eventPayload);
  
  if (parseResult.success) {
    const event = parseResult.data;
    switch (event.type) {
      case 'call.created':
      case 'call.updated':
      case 'call.ended':
        await upsertCallLog(event);
        break;
      default:
        logger.warn({ event }, 'Unhandled call event type');
    }
    return;
  }

  // Handle other VAPI webhook event types (function-call, end-of-call-report, etc.)
  const event = eventPayload as any;
  const eventType = event?.type || event?.message?.type;

  switch (eventType) {
    case 'function-call':
      // Link function calls (orders) to call session
      await handleFunctionCall(event);
      break;

    case 'end-of-call-report':
      // Final call summary with analytics
      await handleEndOfCallReport(event);
      break;

    case 'assistant-request':
      // Handled separately via POST /vapi/assistant-request endpoint
      logger.debug({ event }, 'Assistant request event received (handled by endpoint)');
      break;

    default:
      logger.warn({ eventType, event }, 'Unhandled VAPI event type');
  }
}

async function handleFunctionCall(event: any) {
  try {
    const { message } = event;
    if (!message) return;

    const { toolCalls, call } = message;
    if (!toolCalls || !Array.isArray(toolCalls)) return;

    // Link created orders to call
    for (const toolCall of toolCalls) {
      if (toolCall.function?.name === 'create_order' && toolCall.result) {
        const orderId = toolCall.result?.id;
        const callId = call?.id;

        if (orderId && callId) {
          await supabase
            .from('orders')
            .update({ call_id: callId })
            .eq('id', orderId);

          logger.info({ orderId, callId }, 'Linked order to call via function-call webhook');
        }
      }
    }
  } catch (error) {
    logger.error({ error, event }, 'Failed to handle function-call webhook');
  }
}

async function handleEndOfCallReport(event: any) {
  try {
    const { message } = event;
    if (!message) return;

    const { call, endedReason, transcript, summary, costs } = message;
    if (!call?.id) return;

    // Update call log with final details
    await supabase
      .from('call_logs')
      .update({
        status: 'completed',
        transcript: transcript || null,
        summary: summary || null,
        ended_reason: endedReason || null,
        cost: costs?.total || null,
        updated_at: new Date().toISOString()
      })
      .eq('call_id', call.id);

    logger.info({ callId: call.id, endedReason }, 'End-of-call report processed');
  } catch (error) {
    logger.error({ error, event }, 'Failed to handle end-of-call-report webhook');
  }
}

async function upsertCallLog(event: VapiCallEvent) {
  // Try to find location_id from phone number (multi-location support)
  let locationId: string | null = null;
  
  if (event.data.phoneNumberId) {
    const { data: location } = await supabase
      .from('restaurant_pos_locations')
      .select('id')
      .eq('vapi_phone_number', event.data.phoneNumberId)
      .eq('is_active', true)
      .maybeSingle();
    
    if (location) {
      locationId = location.id;
    }
  }

  const { data, error } = await supabase
    .from('call_logs')
    .upsert(
      {
        call_id: event.data.callId,
        restaurant_id: event.data.restaurantId,
        location_id: locationId,
        customer_phone: event.data.phoneNumber,
        status: event.data.state,
        duration_seconds: event.data.durationSeconds ?? null,
        transcript: event.data.transcript,
        event_type: event.type
      },
      { onConflict: 'call_id' }
    )
    .select('id,call_id,status')
    .maybeSingle();

  if (error) {
    throw Object.assign(new Error('Failed to upsert call log'), {
      status: 500,
      details: error
    });
  }

  if (event.data.state === 'completed' && event.data.durationSeconds) {
    await supabase.rpc('record_call_usage', {
      p_restaurant_id: event.data.restaurantId,
      p_call_duration_seconds: event.data.durationSeconds,
      p_outcome: 'completed'
    });
  } else if (event.data.state === 'failed') {
    await supabase.rpc('record_call_usage', {
      p_restaurant_id: event.data.restaurantId,
      p_call_duration_seconds: event.data.durationSeconds ?? 0,
      p_outcome: 'failed'
    });
  }

  return data;
}
