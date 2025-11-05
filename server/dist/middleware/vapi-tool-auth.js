import { env } from '../config/env.js';
export function requireVapiToolToken(req, res, next) {
    if (!env.VAPI_TOOL_TOKEN) {
        return res.status(500).json({
            message: 'VAPI tool token is not configured',
            code: 'VAPI_TOOL_TOKEN_MISSING'
        });
    }
    const token = req.header('x-vapi-tool-token');
    if (!token || token !== env.VAPI_TOOL_TOKEN) {
        return res.status(401).json({
            message: 'Unauthorized VAPI tool request',
            code: 'UNAUTHORIZED'
        });
    }
    return next();
}
