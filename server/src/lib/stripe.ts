import Stripe from 'stripe';

import { env } from '../config/env.js';

export const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: '2024-06-20',
      typescript: true
    })
  : null;

export function assertStripeConfigured() {
  if (!stripe) {
    throw Object.assign(new Error('Stripe is not configured'), {
      status: 500,
      code: 'STRIPE_NOT_CONFIGURED'
    });
  }
}
