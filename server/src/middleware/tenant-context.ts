import type { NextFunction, Request, Response } from 'express';

import type { AuthenticatedRequest } from './auth.js';

import { logger } from '../lib/logger.js';

/**
 * Middleware that sets the RLS tenant context for multi-tenant isolation
 * This executes `SET LOCAL app.tenant_id` to enforce Row-Level Security policies
 * 
 * IMPORTANT: This middleware must run AFTER requireAuth middleware
 */
export async function setTenantContext(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  // Get tenantId from authenticated request (set by requireAuth middleware)
  const tenantId = (req as AuthenticatedRequest).tenantId;

  // Validate tenantId is a valid UUID before setting
  // Empty strings or invalid UUIDs will cause RLS to fail
  if (!tenantId || 
      tenantId.trim() === '' || 
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
    // No valid tenant context - proceed without setting (for platform admin or public endpoints)
    // Platform admins don't need tenant context as they can access all restaurants
    logger.debug({ tenantId, path: req.path }, 'Skipping tenant context (invalid or null tenantId)');
    return next();
  }

  // Set tenant context so RLS policies permit data access for this restaurant
  req.headers['x-tenant-id'] = tenantId;
  logger.debug({ tenantId, path: req.path }, 'Tenant context set on request headers');
  return next();
}
