import type { NextFunction, Request, Response } from 'express';

import { env } from '../config/env.js';

export function requireVapiToolToken(req: Request, res: Response, next: NextFunction) {
  // Support both VAPI_TOOL_TOKEN and VAPI_TOOL_AUTH_TOKEN (alias)
  const expectedToken = env.VAPI_TOOL_TOKEN || (env as any).VAPI_TOOL_AUTH_TOKEN;
  
  if (!expectedToken) {
    return res.status(500).json({
      message: 'VAPI tool token is not configured',
      code: 'VAPI_TOOL_TOKEN_MISSING'
    });
  }

  const token = req.header('x-vapi-tool-token');
  if (!token || token !== expectedToken) {
    return res.status(401).json({
      message: 'Unauthorized VAPI tool request',
      code: 'UNAUTHORIZED'
    });
  }

  return next();
}
