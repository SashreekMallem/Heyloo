import { describe, expect, it, beforeEach } from 'vitest';

import { useAuthStore } from './useAuthStore';

describe('useAuthStore', () => {
  beforeEach(() => {
    const { logout } = useAuthStore.getState();
    logout();
  });

  it('stores and resets auth session', () => {
    const payload = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: {
        id: 'user-id',
        email: 'user@example.com',
        role: 'platform_admin' as const,
        restaurantId: null
      }
    };

    useAuthStore.getState().setAuth(payload);

    expect(useAuthStore.getState().accessToken).toBe(payload.accessToken);
    expect(useAuthStore.getState().user?.email).toBe(payload.user.email);

    useAuthStore.getState().logout();

    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });
});
