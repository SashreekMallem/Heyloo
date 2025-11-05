import type { NextFunction, Request, Response } from 'express';

import type { JwtPayload } from '@heyloo/shared';

import { logger } from '../lib/logger.js';
import { verifyAccessToken } from '../utils/token.js';

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
  tenantId: string | null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
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
    (req as AuthenticatedRequest).user = payload;
    (req as AuthenticatedRequest).tenantId = payload.restaurantId;
    return next();
  } catch (err: any) {
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
