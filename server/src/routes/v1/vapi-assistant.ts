import { Router } from 'express';
import { z } from 'zod';

import { env } from '../../config/env.js';
import { supabase } from '../../lib/supabase.js';
import { logger } from '../../lib/logger.js';

export const vapiAssistantRouter = Router();

const assistantRequestSchema = z.object({
  message: z.object({
    type: z.string(),
    phoneNumber: z.union([z.string(), z.object({}).passthrough()]).optional(), // VAPI can send string or object
    call: z.object({
      phoneNumberId: z.string().optional(),
      phoneNumber: z.union([z.object({}).passthrough(), z.null()]).optional() // Can be object or null
    }).optional()
  })
});

/**
 * VAPI Dynamic Routing Endpoint
 * This endpoint is called when a call comes in to look up which restaurant
 * owns that phone number and inject their data into the universal assistant
 */
// Normalize phone number - remove +, spaces, dashes, parentheses
function normalizePhoneNumber(phone: string): string {
  return phone.replace(/[\s\-+()]/g, '').replace(/^\+?1?/, '');
}

vapiAssistantRouter.post('/assistant-request', async (req, res) => {
  const startTime = Date.now();
  const callId = req.headers['x-call-id'] as string;
  
  // Log ALL incoming requests to this endpoint for debugging
  logger.info({
    method: req.method,
    path: req.path,
    url: req.url,
    callId,
    headers: {
      'x-vapi-secret': req.headers['x-vapi-secret'] ? 'present' : 'missing',
      'x-call-id': callId,
      'content-type': req.headers['content-type']
    },
    bodyType: typeof req.body,
    hasMessage: !!req.body?.message,
    messageType: req.body?.message?.type,
    fullBody: JSON.stringify(req.body, null, 2)
  }, '📞 [DEBUG] VAPI assistant-request endpoint called - FULL REQUEST');

  try {
    // Check message type FIRST (before schema validation) to handle non-assistant-request messages gracefully
    const messageType = req.body?.message?.type;
    
    logger.info({
      callId,
      messageType,
      hasCall: !!req.body?.message?.call,
      phoneNumberId: req.body?.message?.call?.phoneNumberId,
      fullMessage: JSON.stringify(req.body?.message, null, 2)
    }, '🔍 [DEBUG] Message type check');
    
    // Only process assistant-request messages
    // Return 200 OK for other message types (status-update, speech-update, etc.)
    if (!messageType || messageType !== 'assistant-request') {
      logger.info({ 
        messageType, 
        callId,
        latency: Date.now() - startTime 
      }, '⏭️ [DEBUG] Ignoring non-assistant-request message (returning 200)');
      return res.status(200).json({ ok: true });
    }
    
    // Now do strict schema validation for assistant-request messages only
    logger.info({ callId, body: req.body }, '✅ [DEBUG] Validating assistant-request schema');
    const body = assistantRequestSchema.parse(req.body);
    
    logger.info({ 
      messageType, 
      callId,
      validatedBody: JSON.stringify(body, null, 2)
    }, '✅ [DEBUG] Processing assistant-request message - SCHEMA VALIDATED');
    
    // Get the phone number that was called
    // According to VAPI docs: call.phoneNumberId is a required property on the Call schema
    // It's located at message.call.phoneNumberId
    const directPhoneNumberId = body.message.call?.phoneNumberId;
    const nestedPhoneNumberId = body.message.call?.phoneNumber?.id;
    const phoneNumberId = directPhoneNumberId || nestedPhoneNumberId;
    
    logger.info({
      callId,
      phoneNumberId,
      hasPhoneNumberId: !!phoneNumberId,
      directPhoneNumberId,
      nestedPhoneNumberId,
      callObject: JSON.stringify(body.message.call, null, 2),
      phoneNumberObject: JSON.stringify(body.message.call?.phoneNumber, null, 2)
    }, '🔍 [DEBUG] Extracted phone number ID');
    
    if (!phoneNumberId) {
      logger.warn({ 
        callId,
        body: JSON.stringify(body, null, 2),
        message: body.message,
        fullCall: JSON.stringify(body.message.call, null, 2)
      }, '❌ [DEBUG] No phone number ID in assistant request');
      return res.status(400).json({
        error: 'Phone number ID is required',
        receivedBody: body
      });
    }

    // phoneNumberId is a UUID, not a phone number - use it directly for database lookup
    // vapi_phone_number field stores the UUID of the VAPI phone number
    logger.info({ 
      callId,
      phoneNumberId,
      isUUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(phoneNumberId)
    }, '🔍 [DEBUG] Processing phone number ID lookup (UUID format)');

    // First try to look up by location-specific VAPI phone number (multi-location support)
    // phoneNumberId is a UUID - use it directly to match vapi_phone_number field
    let location = null;
    let locationError = null;
    
    logger.info({
      callId,
      phoneNumberId,
      queryType: 'restaurant_pos_locations',
      lookupField: 'vapi_phone_number'
    }, '🔍 [DEBUG] Starting location lookup by VAPI phone number UUID');
    
    // Look up by vapi_phone_number (which stores the UUID)
    let result = await supabase
      .from('restaurant_pos_locations')
      .select('id,restaurant_id,vapi_phone_number,pos_location_name,restaurants!restaurant_pos_locations_restaurant_id_fkey(id,name,assistant_name)')
      .eq('vapi_phone_number', phoneNumberId)
      .eq('is_active', true)
      .maybeSingle();
    
    logger.info({
      callId,
      hasError: !!result.error,
      hasData: !!result.data,
      error: result.error ? JSON.stringify(result.error, null, 2) : null,
      data: result.data ? JSON.stringify(result.data, null, 2) : null
    }, '🔍 [DEBUG] Location lookup result by UUID');
    
    if (result.error) {
      locationError = result.error;
    } else if (result.data) {
      location = result.data;
    }

    if (locationError) {
      logger.error({ 
        callId,
        error: locationError, 
        phoneNumberId,
        errorDetails: JSON.stringify(locationError, null, 2)
      }, '❌ [DEBUG] Failed to lookup location');
      return res.status(500).json({
        error: 'Failed to lookup location'
      });
    }
    
    logger.info({
      callId,
      foundLocation: !!location,
      locationId: location?.id,
      restaurantId: location?.restaurant_id
    }, '🔍 [DEBUG] Location lookup complete');

    let restaurantId: string;
    let restaurantName: string;
    let assistantName: string | null = null;
    let locationId: string | null = null;
    let locationName: string | null = null;

    if (location) {
      // Found location-specific phone number
      logger.info({
        callId,
        locationData: JSON.stringify(location, null, 2)
      }, '✅ [DEBUG] Found location by VAPI phone');
      
      restaurantId = location.restaurant_id;
      const restaurant = location.restaurants as any;
      restaurantName = restaurant?.name || 'Restaurant';
      assistantName = restaurant?.assistant_name || null;
      locationId = location.id;
      locationName = location.pos_location_name;
      
      logger.info({ 
        callId,
        phoneNumberId, 
        restaurantId, 
        restaurantName,
        locationId, 
        locationName,
        assistantName,
        hasAssistantName: !!assistantName
      }, '✅ [DEBUG] Extracted data from location');
    } else {
      // Fallback to restaurant-level phone number (backward compatibility)
      // Check if phoneNumberId is a UUID or actual phone number
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(phoneNumberId);
      
      logger.info({
        callId,
        phoneNumberId,
        isUUID,
        queryType: 'restaurants',
        lookupField: isUUID ? 'phone_number (UUID stored as phone_number)' : 'phone_number (actual phone number)'
      }, '🔍 [DEBUG] Location not found - FALLBACK to restaurant lookup');
      
      let restaurant = null;
      let error = null;
      
      // If it's a UUID, try looking it up directly (some restaurants might have UUID stored in phone_number)
      // If it's not a UUID, it's an actual phone number - normalize and look up
      let lookupValue = phoneNumberId;
      if (!isUUID) {
        lookupValue = normalizePhoneNumber(phoneNumberId);
        logger.info({
          callId,
          original: phoneNumberId,
          normalized: lookupValue
        }, '🔍 [DEBUG] Normalizing phone number for restaurant lookup');
      }
      
      let result = await supabase
        .from('restaurants')
        .select('id,name,phone_number,assistant_name')
        .eq('phone_number', lookupValue)
        .maybeSingle();
      
      logger.info({
        callId,
        hasError: !!result.error,
        hasData: !!result.data,
        lookupValue,
        error: result.error ? JSON.stringify(result.error, null, 2) : null,
        data: result.data ? JSON.stringify(result.data, null, 2) : null
      }, '🔍 [DEBUG] Restaurant lookup result');
      
      if (result.error) {
        error = result.error;
      } else if (result.data) {
        restaurant = result.data;
      }

      if (error) {
        logger.error({ 
          callId,
          error, 
          phoneNumberId,
          errorDetails: JSON.stringify(error, null, 2)
        }, '❌ [DEBUG] Failed to lookup restaurant');
        return res.status(500).json({
          error: 'Failed to lookup restaurant'
        });
      }

      if (!restaurant) {
        logger.warn({ 
          callId,
          phoneNumberId,
          isUUID,
          lookupValue,
          triedValue: lookupValue
        }, '❌ [DEBUG] No restaurant found for phone number');
        return res.status(404).json({
          error: 'No restaurant found for this phone number',
          phoneNumberId
        });
      }

      restaurantId = restaurant.id;
      restaurantName = restaurant.name;
      assistantName = restaurant.assistant_name || null;
      
      logger.info({ 
        callId,
        phoneNumberId, 
        restaurantId,
        restaurantName,
        assistantName,
        hasAssistantName: !!assistantName
      }, '✅ [DEBUG] Found restaurant by phone (no location-specific)');
    }

    // Return the universal assistant with restaurant/location variables injected
    logger.info({
      callId,
      restaurantId,
      restaurantName,
      assistantName,
      locationId,
      locationName
    }, '🔧 [DEBUG] Building variableValues object');
    
    const variableValues: Record<string, string> = {
      restaurant_id: restaurantId,
      restaurant_name: restaurantName
    };

    if (assistantName) {
      variableValues.assistant_name = assistantName;
      logger.info({ callId, assistantName }, '✅ [DEBUG] Added assistant_name to variableValues');
    } else {
      logger.warn({ callId }, '⚠️ [DEBUG] assistant_name is NULL - not adding to variableValues');
    }

    if (locationId) {
      variableValues.location_id = locationId;
      if (locationName) {
        variableValues.location_name = locationName;
      }
      logger.info({ callId, locationId, locationName }, '✅ [DEBUG] Added location data to variableValues');
    }

    logger.info({
      callId,
      variableValues: JSON.stringify(variableValues, null, 2),
      variableCount: Object.keys(variableValues).length,
      variableKeys: Object.keys(variableValues)
    }, '🔧 [DEBUG] Final variableValues object');

    // Use placeholders in firstMessage - VAPI will replace them from variableValues
    let greeting = 'Thank you for calling {{restaurant_name}}';
    if (assistantName) {
      greeting += '! This is {{assistant_name}}';
    }
    greeting += '! How can I help you today?';

    logger.info({
      callId,
      greeting,
      hasRestaurantPlaceholder: greeting.includes('{{restaurant_name}}'),
      hasAssistantPlaceholder: greeting.includes('{{assistant_name}}')
    }, '🔧 [DEBUG] Built firstMessage with placeholders');

    // Build the response object
    // According to VAPI docs: Response should be simple JSON with one of:
    // - assistantId: when routing to a saved assistant
    // - assistant: when returning a transient assistant config
    // - assistantOverrides can be used with assistantId for variable injection
    // NOTE: toolIds cannot be set dynamically - tools must be attached to the assistant in VAPI dashboard
    // Reference: docs.vapi.ai/server-url/events
    const response = {
      assistantId: env.VAPI_ASSISTANT_ID,
      assistantOverrides: {
        variableValues: variableValues, // Injects {{variable}} placeholders in system prompt
        firstMessage: greeting // Overrides the first message with placeholders
      }
    };

    const latency = Date.now() - startTime;

    // Log the response for debugging - EXTENSIVE LOGGING
    logger.info({
      callId,
      phoneNumberId,
      isUUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(phoneNumberId),
      restaurantId,
      restaurantName,
      assistantName,
      locationId,
      locationName,
      variableValues: JSON.stringify(variableValues, null, 2),
      firstMessage: greeting,
      assistantId: env.VAPI_ASSISTANT_ID,
      note: 'Tools are attached to assistant in VAPI dashboard (not sent dynamically)',
      latency,
      fullResponse: JSON.stringify(response, null, 2)
    }, '📤 [DEBUG] Returning assistant configuration with assistantOverrides - FULL RESPONSE');

    // VAPI expects assistantOverrides format for variable injection
    // Both system prompt and firstMessage use {{variables}} placeholders
    // VAPI will replace them using assistantOverrides.variableValues
    logger.info({
      callId,
      responseStructure: {
        hasAssistantId: !!response.assistantId,
        hasAssistantOverrides: !!response.assistantOverrides,
        hasVariableValues: !!response.assistantOverrides.variableValues,
        hasFirstMessage: !!response.assistantOverrides.firstMessage,
        hasToolIds: !!response.assistantOverrides.toolIds,
        variableValueCount: Object.keys(response.assistantOverrides.variableValues).length
      }
    }, '✅ [DEBUG] Response structure validated - SENDING TO VAPI');
    
    return res.json(response);
  } catch (err: any) {
    const latency = Date.now() - startTime;
    logger.error({ 
      callId: req.headers['x-call-id'],
      err,
      errorMessage: err?.message,
      errorStack: err?.stack,
      errorName: err?.name,
      fullError: JSON.stringify(err, Object.getOwnPropertyNames(err), 2),
      latency,
      requestBody: JSON.stringify(req.body, null, 2)
    }, '❌ [DEBUG] Error in assistant request handler - FULL ERROR DETAILS');
    return res.status(500).json({
      error: 'Internal server error',
      message: err?.message || 'Unknown error'
    });
  }
});
