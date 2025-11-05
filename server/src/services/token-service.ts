import { nanoid } from 'nanoid';
import { supabase } from '../lib/supabase.js';

export async function generateApiToken(restaurantId: string, expiresInDays?: number) {
  const token = `hey_${nanoid(40)}`;
  const tokenPrefix = token.substring(0, 12);

  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const { data, error } = await supabase
    .from('api_tokens')
    .insert({
      restaurant_id: restaurantId,
      token_hash: token, // In production, hash this!
      token_prefix: tokenPrefix,
      expires_at: expiresAt
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to generate token: ${error.message}`);
  }

  return {
    token,
    tokenData: {
      id: data.id,
      restaurantId: data.restaurant_id,
      tokenPrefix: data.token_prefix,
      lastUsedAt: data.last_used_at,
      expiresAt: data.expires_at,
      createdAt: data.created_at,
      revokedAt: data.revoked_at
    }
  };
}

export async function listApiTokens(restaurantId: string) {
  const { data, error } = await supabase
    .from('api_tokens')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to list tokens: ${error.message}`);
  }

  return data.map((token) => ({
    id: token.id,
    restaurantId: token.restaurant_id,
    tokenPrefix: token.token_prefix,
    lastUsedAt: token.last_used_at,
    expiresAt: token.expires_at,
    createdAt: token.created_at,
    revokedAt: token.revoked_at
  }));
}

export async function revokeApiToken(restaurantId: string, tokenId: string) {
  const { error } = await supabase
    .from('api_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', tokenId)
    .eq('restaurant_id', restaurantId);

  if (error) {
    throw new Error(`Failed to revoke token: ${error.message}`);
  }
}

