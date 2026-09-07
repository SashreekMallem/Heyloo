import { api } from './client';

export type PosSyncLog = {
  id: string;
  restaurantId: string;
  syncType: string;
  status: 'success' | 'error';
  itemsSynced: number;
  errorMessage: string | null;
  syncedAt: string;
};

export async function triggerMenuSync(restaurantId: string) {
  const { data } = await api.post(`/pos/${restaurantId}/sync-menu`);
  return data as { synced: number; provider: string };
}

export async function getPosSyncLogs(restaurantId: string, limit = 10) {
  const { data } = await api.get(`/pos/${restaurantId}/sync-logs`, {
    params: { limit }
  });
  return data as PosSyncLog[];
}

export async function getRestaurantPosConfig(restaurantId: string) {
  const { data } = await api.get(`/restaurants/${restaurantId}/pos-config`);
  return data as {
    posType: string;
    posLocationId: string | null;
    locationCount?: number; // Number of connected POS locations
    lastSyncAt: string | null;
  };
}

