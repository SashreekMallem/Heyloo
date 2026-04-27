# Heyloo — AI Restaurant Operating System

A full-stack restaurant management platform with AI voice ordering, POS integrations (Clover, Square), real-time order management, and a WebGPU-accelerated analytics dashboard.

Built PRD-first. The product spec came before a single line of code.

## What it does

- **AI voice assistant** — VAPI-powered voice ordering and customer interaction
- **POS integration** — Clover and Square sync for order and payment data
- **Real-time order management** — Live order tracking across kitchen and front-of-house
- **Multi-location support** — Platform-level and restaurant-level views
- **Customer management** — Profiles, order history, preferences
- **Billing & subscriptions** — Monthly billing automation via Supabase edge functions
- **WebGPU dashboard** — 3D particle-accelerated analytics display (browser-native GPU compute)

## Tech stack

- **Frontend** — React, TypeScript, Tailwind CSS
- **Backend** — Supabase (Postgres + Auth + Storage), Deno edge functions
- **Voice AI** — VAPI for conversational ordering
- **POS** — Clover API, Square webhook integration
- **Payments** — Stripe
- **Edge functions** — Auth, onboarding, order management, POS sync, billing, VAPI tools, webhooks
- **Dashboard** — WebGPU-accelerated 3D rendering for real-time analytics

## Edge functions

| Function | Purpose |
|----------|---------|
| `auth` | JWT-based authentication with access + refresh tokens |
| `onboarding` | Restaurant onboarding with POS OAuth flow |
| `pos` / `pos-sync` / `pos-push` | POS data sync and push notifications |
| `orders` | Order lifecycle management |
| `vapi-assistant` / `vapi-tools` / `vapi-events` | Voice AI integration |
| `clover-webhook` / `square-webhook` / `stripe-webhook` | Payment and POS webhooks |
| `monthly-billing` | Automated subscription billing |
| `restaurants` / `platform` | Core restaurant and platform data |

## Architecture note

The entire backend runs as Supabase Deno edge functions — no separate server. Each function is independently deployable. The WebGPU dashboard was built to explore how far browser-native GPU compute can push real-time data visualisation without a dedicated graphics runtime.
