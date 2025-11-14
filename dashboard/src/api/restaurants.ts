import { api } from './client';

export async function fetchRestaurantDetails(restaurantId: string) {
  const { data } = await api.get(`/restaurants/${restaurantId}`);
  return data;
}

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

export async function createManualMenuItem(restaurantId: string, payload: any) {
  const { data } = await api.post(`/restaurants/${restaurantId}/menu`, payload);
  return data;
}

export async function updateManualMenuItem(
  restaurantId: string,
  itemId: string,
  payload: any
) {
  const { data } = await api.patch(`/restaurants/${restaurantId}/menu/${itemId}`, payload);
  return data;
}

export async function deleteManualMenuItem(restaurantId: string, itemId: string) {
  await api.delete(`/restaurants/${restaurantId}/menu/${itemId}`);
}

export async function createManualCustomer(restaurantId: string, payload: any) {
  const { data } = await api.post(`/restaurants/${restaurantId}/customers`, payload);
  return data;
}

export async function updateManualCustomer(
  restaurantId: string,
  customerId: string,
  payload: any
) {
  const { data } = await api.patch(`/restaurants/${restaurantId}/customers/${customerId}`, payload);
  return data;
}

export async function deleteManualCustomer(restaurantId: string, customerId: string) {
  await api.delete(`/restaurants/${restaurantId}/customers/${customerId}`);
}

export async function createManualOrder(restaurantId: string, payload: any) {
  const { data } = await api.post(`/restaurants/${restaurantId}/orders/manual`, payload);
  return data;
}
