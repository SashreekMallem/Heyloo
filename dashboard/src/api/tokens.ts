import { api } from './client';

export type ApiToken = {
  id: string;
  restaurantId: string;
  tokenPrefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
};

export async function generateToken(restaurantId: string, expiresInDays?: number) {
  const { data } = await api.post(`/restaurants/${restaurantId}/tokens`, {
    expiresInDays
  });
  return data as { token: string; tokenData: ApiToken };
}

export async function listTokens(restaurantId: string) {
  const { data } = await api.get(`/restaurants/${restaurantId}/tokens`);
  return data as ApiToken[];
}

export async function revokeToken(restaurantId: string, tokenId: string) {
  await api.delete(`/restaurants/${restaurantId}/tokens/${tokenId}`);
}

