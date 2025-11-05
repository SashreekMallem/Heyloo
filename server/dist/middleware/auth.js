import { logger } from '../lib/logger.js';
import { verifyAccessToken } from '../utils/token.js';
export function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        logger.warn({
            path: req.path,
            method: req.method,
            hasAuthHeader: !!authHeader,
            authHeaderPrefix: authHeader?.substring(0, 20)
        }, 'Missing or invalid authorization header');
        return res.status(401).json({
            message: 'Missing or invalid authorization header',
            code: 'UNAUTHORIZED',
            debug: {
                path: req.path,
                hasAuthHeader: !!authHeader,
                authHeaderPrefix: authHeader?.substring(0, 20)
            }
        });
    }
    const token = authHeader.slice('Bearer '.length);
    try {
        const payload = verifyAccessToken(token);
        logger.debug({
            userId: payload.sub,
            email: payload.email,
            role: payload.role,
            restaurantId: payload.restaurantId,
            path: req.path
        }, 'Token verified successfully');
        req.user = payload;
        req.tenantId = payload.restaurantId;
        return next();
    }
    catch (err) {
        logger.warn({
            err: err.message,
            path: req.path,
            tokenLength: token.length,
            tokenPrefix: token.substring(0, 20)
        }, 'Token verification failed');
        return res.status(401).json({
            message: 'Invalid or expired token',
            code: 'UNAUTHORIZED',
            debug: {
                path: req.path,
                error: err.message,
                tokenLength: token.length
            }
        });
    }
}
