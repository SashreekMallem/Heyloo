import bcrypt from 'bcryptjs';
import { supabase } from '../lib/supabase.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/token.js';
export async function login({ email, password }) {
    // Use security definer function to bypass RLS for login lookup
    // This is safe because we're only looking up by email and verifying password
    const { data: userData, error: rpcError } = await supabase
        .rpc('get_user_for_login', {
        p_email: email
    });
    if (rpcError) {
        throw Object.assign(new Error('Failed to fetch user'), {
            status: 500,
            code: 'DATABASE_ERROR',
            details: rpcError
        });
    }
    // RPC returns array, get first result
    const data = userData && userData.length > 0 ? userData[0] : null;
    if (!data) {
        throw Object.assign(new Error('Invalid credentials'), {
            status: 401,
            code: 'INVALID_CREDENTIALS'
        });
    }
    const passwordMatches = await bcrypt.compare(password, data.password_hash);
    if (!passwordMatches) {
        throw Object.assign(new Error('Invalid credentials'), {
            status: 401,
            code: 'INVALID_CREDENTIALS'
        });
    }
    const payload = {
        sub: data.id,
        email: data.email,
        role: data.role,
        restaurantId: data.restaurant_id
    };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);
    return {
        accessToken,
        refreshToken,
        expiresIn: 900,
        user: {
            id: data.id,
            email: data.email,
            role: data.role,
            restaurantId: data.restaurant_id
        }
    };
}
export async function refreshTokens({ refreshToken }) {
    // Verify token first
    let payload;
    try {
        payload = verifyRefreshToken(refreshToken);
    }
    catch (err) {
        // Re-throw token verification errors (they already have proper status codes)
        throw err;
    }
    // Use security definer function to bypass RLS for refresh token lookup
    // This is safe because we're looking up the user by their own ID from the verified token
    const { data: userData, error: rpcError } = await supabase
        .rpc('get_user_for_refresh', {
        p_user_id: payload.sub
    });
    if (rpcError) {
        throw Object.assign(new Error('Failed to fetch user'), {
            status: 500,
            code: 'DATABASE_ERROR',
            details: rpcError
        });
    }
    // RPC returns array, get first result
    const data = userData && userData.length > 0 ? userData[0] : null;
    if (!data) {
        throw Object.assign(new Error('User not found'), {
            status: 404,
            code: 'USER_NOT_FOUND'
        });
    }
    const newPayload = {
        sub: data.id,
        email: data.email,
        role: data.role,
        restaurantId: data.restaurant_id
    };
    return {
        accessToken: signAccessToken(newPayload),
        refreshToken: signRefreshToken(newPayload),
        expiresIn: 900,
        user: {
            id: data.id,
            email: data.email,
            role: data.role,
            restaurantId: data.restaurant_id
        }
    };
}
