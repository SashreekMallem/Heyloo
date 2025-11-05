import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { supabase } from '../../lib/supabase.js';
import { logger } from '../../lib/logger.js';
export const vapiAssistantRouter = Router();
const assistantRequestSchema = z.object({
    message: z.object({
        type: z.string(),
        phoneNumber: z.string().optional(),
        call: z.object({
            phoneNumberId: z.string().optional()
        }).optional()
    })
});
/**
 * VAPI Dynamic Routing Endpoint
 * This endpoint is called when a call comes in to look up which restaurant
 * owns that phone number and inject their data into the universal assistant
 */
vapiAssistantRouter.post('/assistant-request', async (req, res) => {
    try {
        const body = assistantRequestSchema.parse(req.body);
        // Get the phone number that was called
        const phoneNumberId = body.message.call?.phoneNumberId;
        if (!phoneNumberId) {
            logger.warn({ body }, 'No phone number ID in assistant request');
            return res.status(400).json({
                error: 'Phone number ID is required'
            });
        }
        // First try to look up by location-specific VAPI phone number (multi-location support)
        const { data: location, error: locationError } = await supabase
            .from('restaurant_pos_locations')
            .select('id,restaurant_id,vapi_phone_number,pos_location_name,restaurants!restaurant_pos_locations_restaurant_id_fkey(id,name)')
            .eq('vapi_phone_number', phoneNumberId)
            .eq('is_active', true)
            .maybeSingle();
        if (locationError) {
            logger.error({ error: locationError, phoneNumberId }, 'Failed to lookup location');
            return res.status(500).json({
                error: 'Failed to lookup location'
            });
        }
        let restaurantId;
        let restaurantName;
        let locationId = null;
        let locationName = null;
        if (location) {
            // Found location-specific phone number
            restaurantId = location.restaurant_id;
            restaurantName = location.restaurants?.name || 'Restaurant';
            locationId = location.id;
            locationName = location.pos_location_name;
            logger.info({ phoneNumberId, restaurantId, locationId }, 'Found location by VAPI phone');
        }
        else {
            // Fallback to restaurant-level phone number (backward compatibility)
            const { data: restaurant, error } = await supabase
                .from('restaurants')
                .select('id,name,phone_number')
                .eq('phone_number', phoneNumberId)
                .maybeSingle();
            if (error) {
                logger.error({ error, phoneNumberId }, 'Failed to lookup restaurant');
                return res.status(500).json({
                    error: 'Failed to lookup restaurant'
                });
            }
            if (!restaurant) {
                logger.warn({ phoneNumberId }, 'No restaurant found for phone number');
                return res.status(404).json({
                    error: 'No restaurant found for this phone number'
                });
            }
            restaurantId = restaurant.id;
            restaurantName = restaurant.name;
            logger.info({ phoneNumberId, restaurantId }, 'Found restaurant by phone (no location-specific)');
        }
        // Return the universal assistant with restaurant/location variables injected
        const variableValues = {
            restaurant_id: restaurantId,
            restaurant_name: restaurantName
        };
        if (locationId) {
            variableValues.location_id = locationId;
            if (locationName) {
                variableValues.location_name = locationName;
            }
        }
        return res.json({
            assistant: {
                assistantId: env.VAPI_ASSISTANT_ID,
                firstMessage: locationName
                    ? `Thank you for calling ${restaurantName} - ${locationName}! How can I help you today?`
                    : `Thank you for calling ${restaurantName}! How can I help you today?`,
                variableValues
            }
        });
    }
    catch (err) {
        logger.error({ err }, 'Error in assistant request handler');
        return res.status(500).json({
            error: 'Internal server error'
        });
    }
});
