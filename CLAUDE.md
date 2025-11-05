# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Development
- `npm run dev:api` - Start API server in development mode
- `npm run dev:dashboard` - Start dashboard in development mode  
- `npm run install:all` - Install dependencies for all workspaces
- `npm run build` - Build all workspaces
- `npm run test` - Run tests across all workspaces
- `npm run lint` - Run linting across all workspaces

### Individual Workspace Commands
Run from root with `--workspace <name>` or cd into workspace:
- **Dashboard**: `npm run dev`, `npm run test`, `npm run lint`
- **Server**: `npm run dev`, `npm run test`, `npm run lint`

## Architecture Overview

### Monorepo Structure
- **Workspaces**: `server/` (Node.js/Express API), `dashboard/` (React frontend), `packages/shared`
- **Database**: Supabase PostgreSQL with migrations in `supabase/`
- **Shared Package**: `@heyloo/shared` contains Zod schemas and common types

### Authentication & Multi-tenancy
- JWT-based auth with access/refresh tokens
- Role-based access: `platform_admin` and `restaurant_admin`
- Tenant isolation using `restaurant_id` with Row Level Security (RLS)
- Middleware chain: `requireAuth` → `setTenantContext` for protected routes

### API Structure
Routes are versioned under `/v1/` with modular organization:
- `/v1/auth` - Authentication endpoints
- `/v1/platform` - Platform admin analytics  
- `/v1/restaurants` - Restaurant management
- `/v1/orders` - Order processing
- `/v1/pos` - POS system integrations
- `/v1/vapi` - Voice AI endpoints
- `/webhooks/*` - External service webhooks

### POS Integration Pattern
Uses factory pattern (`server/src/integrations/factory.ts`) with:
- Supported providers: Square, Toast, Clover
- Singleton caching for integration instances
- External ID mapping for cross-system compatibility

### Frontend Architecture
- React 18 + TypeScript + Vite
- Zustand for auth state management with persistence
- React Router v6 with protected routes
- Axios client with token interceptors
- Tailwind CSS + Recharts/Chart.js for analytics

### Database Patterns
- Migration-based schema management in `supabase/migrations/`
- Database functions for secure operations (e.g., `get_user_for_login`)
- Tenant-scoped queries with RLS policies
- Audit trails with timestamps and triggers

### Voice AI Integration (VAPI)
- Tool-based architecture for AI assistant interactions
- Webhook endpoints for real-time AI events
- Menu integration for voice order processing

## Key Configuration

### TypeScript Setup
- Shared config in `tsconfig.base.json`
- Path mapping for `@heyloo/shared/*`
- ES2022 target with strict settings

### Environment Variables
Validated with Zod schemas in `server/src/config/env.ts`:
- Database connection strings
- JWT secrets and expiration times
- POS system API credentials
- VAPI configuration

### Security Middleware Stack
Applied in order: Helmet → CORS → Rate Limiting → Auth → Tenant Context

## Testing Strategy
- **Unit Tests**: Vitest with Testing Library
- **API Tests**: Located in `server/test/`
- **Integration Tests**: Manual verification guides in docs