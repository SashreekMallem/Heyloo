# About This Project

## Overview

This is a comprehensive restaurant voice AI platform that enables restaurants to handle customer calls using artificial intelligence. The platform provides automated phone order processing, menu management, and analytics dashboards for both platform owners and restaurant operators.

## Key Features

### 🎙️ Voice AI Integration
- Automated phone call handling using VAPI
- Natural language processing for order taking
- Real-time menu integration
- Payment link generation and order processing

### 📊 Dual Analytics Dashboards

#### Platform Owner Dashboard
- **Revenue Tracking**: MRR, CAC, LTV, Churn Rate
- **Usage Analytics**: Call volumes, peak times, cost analysis
- **Restaurant Management**: Monitor all restaurant accounts, subscriptions, and performance
- **Financial Metrics**: Revenue per restaurant, VAPI costs, net profit margins

#### Restaurant Owner Dashboard
- **Sales Analytics**: Daily/weekly/monthly revenue trends
- **Order Management**: Live order board with real-time updates
- **Voice AI Performance**: Call metrics, conversion rates, common questions
- **Customer Insights**: Loyalty tracking, retention rates, top customers

### 🔐 Security & Authentication
- JWT token-based authentication
- Tenant isolation using Row-Level Security (RLS)
- Secure API endpoints with refresh token rotation
- Multi-restaurant support with isolated data access

### 💳 Billing & Subscriptions
- Flexible pricing models (fixed subscription or usage-based)
- Stripe integration for payments
- Automatic invoicing and usage metering
- Subscription management (trial, active, cancelled)

### 🗄️ Database Architecture
- Supabase PostgreSQL backend
- Real-time subscriptions for live updates
- Optimized indexes for analytics queries
- Platform-wide and restaurant-scoped data views

## Technology Stack

- **Frontend**: React + Chart.js/Recharts for analytics visualization
- **Backend**: Node.js + Express
- **Database**: Supabase (PostgreSQL)
- **Payment Processing**: Stripe
- **Voice AI**: VAPI
- **Authentication**: JWT tokens

## Documentation

For complete implementation details, see:
- **[Platform Documentation](./PLATFORM_DOCUMENTATION.md)** - Complete technical documentation covering:
  - Platform owner analytics dashboard
  - Restaurant owner analytics dashboard
  - API token management and authentication
  - Database schemas and queries
  - Usage metering and billing implementation

## Project Structure

```
Heyloo/
├── ABOUT_PROJECT.md              # This file - project overview
├── PLATFORM_DOCUMENTATION.md     # Complete technical documentation
└── [Other project files...]
```

## Getting Started

This documentation provides a research-backed, production-ready foundation for building the platform. Key implementation areas include:

1. **Database Setup**: SQL schemas for tracking usage, subscriptions, and analytics
2. **API Endpoints**: Authentication, dashboard data, and webhook handlers
3. **Dashboard UI**: React components for visualizing metrics and managing restaurants
4. **Security**: JWT authentication with tenant isolation
5. **Billing**: Stripe integration for subscription and usage-based billing

> **Implemented:** Clone the repo, run `npm install`, then start both services with `npm run dev:api` and `npm run dev:dashboard`. Supabase migrations and seeds sit in `supabase/` and can be applied through the MCP Supabase RW server.

## Core Metrics Tracked

### Platform-Level Metrics
- Monthly Recurring Revenue (MRR)
- Active vs Inactive Restaurants
- Total call minutes and costs
- Profit margins per restaurant
- Customer acquisition and churn

### Restaurant-Level Metrics
- Daily/weekly/monthly revenue
- Order conversion rates
- Voice AI call performance
- Customer loyalty and retention
- Peak order times and trends

## Next Steps

Refer to `PLATFORM_DOCUMENTATION.md` for:
- Detailed database schema implementations
- API endpoint specifications
- Frontend dashboard component structures
- Security best practices
- Usage metering and billing logic

---

**Note**: This platform is designed to be scalable, secure, and provide actionable insights for both platform operators and restaurant owners.
