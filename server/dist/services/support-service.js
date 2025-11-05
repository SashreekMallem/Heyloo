import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
/**
 * Create a support request when AI cannot help customer
 * This is called by VAPI tool when escalation is needed
 */
export async function createSupportRequest(payload) {
    const { data, error } = await supabase
        .from('support_requests')
        .insert({
        restaurant_id: payload.restaurantId,
        customer_phone: payload.customerPhone,
        customer_name: payload.customerName ?? null,
        call_id: payload.callId ?? null,
        order_id: payload.orderId ?? null,
        request_type: payload.requestType,
        priority: payload.priority ?? 'medium',
        status: 'open',
        subject: payload.subject,
        description: payload.description,
        ai_transcript: payload.aiTranscript ?? null
    })
        .select()
        .single();
    if (error) {
        logger.error({ error, payload }, 'Failed to create support request');
        throw Object.assign(new Error('Failed to create support request'), {
            status: 500,
            details: error
        });
    }
    logger.info({ supportRequestId: data.id, restaurantId: payload.restaurantId }, 'Support request created');
    return data;
}
/**
 * List support requests for a restaurant
 */
export async function listSupportRequests(restaurantId, status) {
    let query = supabase
        .from('support_requests')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false });
    if (status) {
        query = query.eq('status', status);
    }
    const { data, error } = await query;
    if (error) {
        logger.error({ error, restaurantId }, 'Failed to list support requests');
        throw Object.assign(new Error('Failed to list support requests'), {
            status: 500,
            details: error
        });
    }
    return data;
}
/**
 * Update support request status
 */
export async function updateSupportRequest(requestId, restaurantId, updates) {
    const { data, error } = await supabase
        .from('support_requests')
        .update({
        ...updates,
        updated_at: new Date().toISOString()
    })
        .eq('id', requestId)
        .eq('restaurant_id', restaurantId)
        .select()
        .single();
    if (error) {
        logger.error({ error, requestId }, 'Failed to update support request');
        throw Object.assign(new Error('Failed to update support request'), {
            status: 500,
            details: error
        });
    }
    return data;
}
/**
 * Add note to support request
 */
export async function addSupportRequestNote(requestId, createdBy, note, isInternal = true) {
    const { data, error } = await supabase
        .from('support_request_notes')
        .insert({
        support_request_id: requestId,
        created_by: createdBy,
        note,
        is_internal: isInternal
    })
        .select()
        .single();
    if (error) {
        logger.error({ error, requestId }, 'Failed to add support request note');
        throw Object.assign(new Error('Failed to add support request note'), {
            status: 500,
            details: error
        });
    }
    return data;
}
/**
 * Get support request with notes
 */
export async function getSupportRequestWithNotes(requestId, restaurantId) {
    const [requestResult, notesResult] = await Promise.all([
        supabase
            .from('support_requests')
            .select('*')
            .eq('id', requestId)
            .eq('restaurant_id', restaurantId)
            .single(),
        supabase
            .from('support_request_notes')
            .select('*')
            .eq('support_request_id', requestId)
            .order('created_at', { ascending: true })
    ]);
    if (requestResult.error) {
        logger.error({ error: requestResult.error, requestId }, 'Failed to get support request');
        throw Object.assign(new Error('Support request not found'), {
            status: 404,
            details: requestResult.error
        });
    }
    return {
        request: requestResult.data,
        notes: notesResult.data ?? []
    };
}
