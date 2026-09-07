import { create } from 'zustand';
import { persist } from 'zustand/middleware';
export const useAuthStore = create()(persist((set) => ({
    accessToken: null,
    refreshToken: null,
    user: null,
    setAuth: ({ accessToken, refreshToken, user }) => set(() => ({
        accessToken,
        refreshToken,
        user
    })),
    logout: () => set(() => ({
        accessToken: null,
        refreshToken: null,
        user: null
    }))
}), {
    name: 'heyloo-auth'
}));
export const selectAuth = (state) => ({
    accessToken: state.accessToken,
    refreshToken: state.refreshToken,
    user: state.user
});
