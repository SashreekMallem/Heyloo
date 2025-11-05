import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { CloverIntegration } from './clover.js';
import { NullPosIntegration } from './base.js';
import { SquareIntegration } from './square.js';
import { ToastIntegration } from './toast.js';
const singletonCache = new Map();
export function getPosIntegration(provider) {
    if (provider === 'none') {
        return new NullPosIntegration();
    }
    if (singletonCache.has(provider)) {
        return singletonCache.get(provider);
    }
    try {
        let integration;
        switch (provider) {
            case 'square': {
                integration = new SquareIntegration();
                break;
            }
            case 'toast': {
                integration = new ToastIntegration();
                break;
            }
            case 'clover': {
                integration = new CloverIntegration();
                break;
            }
            default:
                integration = new NullPosIntegration();
        }
        singletonCache.set(provider, integration);
        return integration;
    }
    catch (error) {
        logger.warn({ err: error, provider }, 'Failed to initialise POS integration, falling back to stub');
        const fallback = new NullPosIntegration();
        singletonCache.set(provider, fallback);
        return fallback;
    }
}
export function getRestaurantExternalId(provider, overrides) {
    switch (provider) {
        case 'square':
            return overrides?.squareLocationId ?? env.SQUARE_LOCATION_ID ?? '';
        case 'toast':
            return env.TOAST_PARTNER_CLIENT_ID ?? '';
        case 'clover':
            return env.CLOVER_MERCHANT_ID ?? '';
        default:
            return '';
    }
}
