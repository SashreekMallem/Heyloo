import { api } from './client';

export async function fetchRestaurantOverview(restaurantId: string, range: string) {
  const { data } = await api.get(`/restaurants/${restaurantId}/overview`, {
    params: { range }
  });
  return data as {
    calls: number;
    minutes: number;
    orders: number;
    revenue: number;
    deliveryOrders: number;
    pickupOrders: number;
  };
}

export async function fetchRestaurantOrders(restaurantId: string) {
  const { data } = await api.get(`/restaurants/${restaurantId}/orders`);
  return data;
}

export async function fetchRestaurantCalls(restaurantId: string) {
  const { data } = await api.get(`/restaurants/${restaurantId}/calls`);
  return data;
}

export async function fetchRestaurantMenu(restaurantId: string) {
  const { data } = await api.get(`/restaurants/${restaurantId}/menu`);
  return data;
}
