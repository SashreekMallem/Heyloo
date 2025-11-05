import jwt from 'jsonwebtoken';
import { jwtPayloadSchema } from '@heyloo/shared';
import { env } from '../config/env.js';
const ACCESS_TOKEN_TTL_SECONDS = 60 * 15; // 15 minutes
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
export function signAccessToken(payload) {
    return jwt.sign(payload, env.JWT_SECRET, {
        expiresIn: ACCESS_TOKEN_TTL_SECONDS
    });
}
export function signRefreshToken(payload) {
    return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
        expiresIn: REFRESH_TOKEN_TTL_SECONDS
    });
}
export function verifyAccessToken(token) {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    return jwtPayloadSchema.parse(decoded);
}
export function verifyRefreshToken(token) {
    try {
        const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET);
        return jwtPayloadSchema.parse(decoded);
    }
    catch (err) {
        if (err.name === 'JsonWebTokenError') {
            throw Object.assign(new Error('Invalid refresh token'), {
                status: 401,
                code: 'INVALID_REFRESH_TOKEN'
            });
        }
        if (err.name === 'TokenExpiredError') {
            throw Object.assign(new Error('Refresh token expired'), {
                status: 401,
                code: 'REFRESH_TOKEN_EXPIRED'
            });
        }
        throw Object.assign(new Error('Failed to verify refresh token'), {
            status: 401,
            code: 'TOKEN_VERIFICATION_FAILED',
            details: err.message
        });
    }
}
