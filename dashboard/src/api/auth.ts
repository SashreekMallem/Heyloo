import type { AuthResponse } from '@heyloo/shared';

import { api } from './client';

type LoginPayload = {
  email: string;
  password: string;
};

export async function login(payload: LoginPayload) {
  const { data } = await api.post<AuthResponse>('/auth/login', payload);
  return data;
}
