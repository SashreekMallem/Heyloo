import { api } from './client';

export type Customer = {
  id: string;
  restaurantId: string;
  phoneNumber: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  notes: string | null;
  totalOrders: number;
  totalSpent: number;
  createdAt: string;
  updatedAt: string;
};

export type CustomerAddress = {
  id: string;
  customerId: string;
  restaurantId: string;
  label: string | null;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  deliveryInstructions: string | null;
  isDefault: boolean;
  createdAt: string;
};

export async function fetchRestaurantCustomers(restaurantId: string) {
  const { data } = await api.get<Customer[]>(`/restaurants/${restaurantId}/customers`);
  return data;
}

export async function fetchCustomerAddresses(restaurantId: string, customerId: string) {
  const { data } = await api.get<CustomerAddress[]>(
    `/restaurants/${restaurantId}/customers/${customerId}/addresses`
  );
  return data;
}

