import 'dotenv/config';
import { z } from 'zod';
const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(4000),
    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string(),
    SUPABASE_ANON_KEY: z.string().optional(),
    JWT_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    VAPI_WEBHOOK_SECRET: z.string(),
    VAPI_API_KEY: z.string(),
    VAPI_ASSISTANT_ID: z.string().optional(),
    VAPI_TOOL_TOKEN: z.string().optional(),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_PHONE_NUMBER: z.string().optional(),
    SQUARE_ACCESS_TOKEN: z.string().optional(),
    SQUARE_LOCATION_ID: z.string().optional(),
    SQUARE_CLIENT_ID: z.string().optional(),
    SQUARE_CLIENT_SECRET: z.string().optional(),
    SQUARE_ENVIRONMENT: z.enum(['production', 'sandbox']).default('production'),
    TOAST_API_KEY: z.string().optional(),
    TOAST_CLIENT_ID: z.string().optional(),
    TOAST_CLIENT_SECRET: z.string().optional(),
    TOAST_PARTNER_CLIENT_ID: z.string().optional(),
    CLOVER_API_KEY: z.string().optional(),
    CLOVER_MERCHANT_ID: z.string().optional(),
    CLOVER_APP_ID: z.string().optional(),
    CLOVER_APP_SECRET: z.string().optional(),
    API_URL: z.string().url().optional(),
    FRONTEND_URL: z.string().url().optional(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info')
});
const envResult = envSchema.safeParse(process.env);
if (!envResult.success) {
    // eslint-disable-next-line no-console
    console.error('❌ Invalid environment variables:', envResult.error.flatten());
    throw new Error('Invalid environment variables');
}
export const env = envResult.data;
