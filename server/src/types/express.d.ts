import type { JwtPayload } from '@heyloo/shared';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      tenantId?: string | null;
    }
  }
}

export {};
