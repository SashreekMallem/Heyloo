import rateLimit from 'express-rate-limit';
import { logger } from '../lib/logger.js';
/**
 * General API rate limiter - 100 requests per 15 minutes per IP
 */
export const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    // Skip validation warnings - we control trust proxy at Express level
    validate: false,
    handler: (req, res) => {
        logger.warn({ ip: req.ip, path: req.path }, 'Rate limit exceeded');
        res.status(429).json({
            message: 'Too many requests, please try again later.',
            code: 'RATE_LIMIT_EXCEEDED'
        });
    }
});
/**
 * Strict rate limiter for authentication endpoints - 5 attempts per 15 minutes
 */
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    skipSuccessfulRequests: true,
    message: 'Too many login attempts, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    handler: (req, res) => {
        logger.warn({ ip: req.ip, email: req.body?.email }, 'Auth rate limit exceeded');
        res.status(429).json({
            message: 'Too many login attempts. Please try again in 15 minutes.',
            code: 'AUTH_RATE_LIMIT_EXCEEDED'
        });
    }
});
/**
 * VAPI tool rate limiter - 200 requests per minute (high volume for voice calls)
 */
export const vapiToolLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 200,
    message: 'VAPI tool rate limit exceeded',
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    handler: (req, res) => {
        logger.error({ ip: req.ip, tool: req.path }, 'VAPI tool rate limit exceeded');
        res.status(429).json({
            message: 'Service temporarily unavailable, please try again.',
            code: 'RATE_LIMIT_EXCEEDED'
        });
    }
});
/**
 * Webhook rate limiter - 1000 requests per minute (webhooks can be high volume)
 */
export const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 1000,
    message: 'Webhook rate limit exceeded',
    standardHeaders: true,
    legacyHeaders: false,
    validate: false
});
