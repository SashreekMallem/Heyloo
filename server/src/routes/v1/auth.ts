import { Router } from 'express';
import { z } from 'zod';

import { logger } from '../../lib/logger.js';
import { login, refreshTokens } from '../../services/auth-service.js';
import { authLimiter } from '../../middleware/rate-limit.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1) // Accept any non-empty password
});

const refreshSchema = z.object({
  refreshToken: z.string().min(10) // JWT tokens are longer, but be lenient
});

export const authRouter = Router();

// Apply stricter rate limiting to login endpoint
authRouter.post('/login', authLimiter, async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const response = await login(body);
    res.json(response);
  } catch (err) {
    next(err);
  }
});

authRouter.post('/refresh', async (req, res, next) => {
  try {
    logger.debug({ body: req.body }, 'Refresh token request received');
    const body = refreshSchema.parse(req.body);
    logger.debug({ hasRefreshToken: !!body.refreshToken, tokenLength: body.refreshToken?.length }, 'Refresh token parsed');
    const response = await refreshTokens(body);
    res.json(response);
  } catch (err: any) {
    logger.error({ err: err.message, body: req.body, issues: err.issues, stack: err.stack }, 'Refresh token error');
    if (err.name === 'ZodError') {
      return res.status(400).json({
        message: 'Invalid refresh token format',
        code: 'VALIDATION_ERROR',
        debug: {
          receivedBody: req.body,
          validationErrors: err.issues
        }
      });
    }
    // Pass error to error handler middleware
    next(err);
  }
});

authRouter.post('/logout', async (req, res) => {
  // For stateless JWT, logout is client-side only
  // If using refresh tokens in DB, delete them here
  // For now, just return success
  logger.info('User logged out');
  res.json({ message: 'Logged out successfully' });
});
