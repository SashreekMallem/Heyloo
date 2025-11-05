import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type UserRole = 'platform_admin' | 'restaurant_admin';

type User = {
  id: string;
  email: string;
  role: UserRole;
  restaurantId: string | null;
};

type AuthState = {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  setAuth: (payload: { accessToken: string; refreshToken: string; user: User }) => void;
  logout: () => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      setAuth: ({ accessToken, refreshToken, user }) =>
        set(() => ({
          accessToken,
          refreshToken,
          user
        })),
      logout: () =>
        set(() => ({
          accessToken: null,
          refreshToken: null,
          user: null
        }))
    }),
    {
      name: 'heyloo-auth'
    }
  )
);

export const selectAuth = (state: AuthState) => ({
  accessToken: state.accessToken,
  refreshToken: state.refreshToken,
  user: state.user
});
