import axios from 'axios';

import { useAuthStore } from '../hooks/useAuthStore';

// Use Supabase Edge Functions URL
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://fjfhwbtovmbooaqafdxb.supabase.co';
const API_BASE_URL = import.meta.env.VITE_API_URL ?? `${SUPABASE_URL}/functions/v1`;

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000
});

api.interceptors.request.use((config) => {
  const { accessToken } = useAuthStore.getState();

  if (accessToken && config.headers) {
    config.headers.Authorization = `Bearer ${accessToken}`;
    console.log('🔵 [API Request]', {
      url: config.url,
      method: config.method,
      hasToken: !!accessToken,
      tokenPrefix: accessToken.substring(0, 20)
    });
  } else {
    console.error('🔴 [API Request] MISSING TOKEN!', {
      url: config.url,
      method: config.method,
      hasToken: !!accessToken,
      storeState: useAuthStore.getState()
    });
  }

  return config;
});

let isRefreshing = false;
let refreshQueue: Array<(token: string | null) => void> = [];

async function refreshAccessToken() {
  if (isRefreshing) {
    return new Promise<string | null>((resolve) => {
      refreshQueue.push(resolve);
    });
  }

  isRefreshing = true;

  const { refreshToken, setAuth, logout, user } = useAuthStore.getState();

  if (!refreshToken || !user) {
    logout();
    isRefreshing = false;
    return null;
  }

  try {
    console.log('🟡 [Refresh Token] Attempting refresh', {
      hasRefreshToken: !!refreshToken,
      tokenLength: refreshToken?.length,
      tokenPrefix: refreshToken?.substring(0, 20),
      requestPayload: { refreshToken }
    });
    
    // Use the api instance to ensure baseURL is correct
    const response = await api.post('/auth/refresh', {
      refreshToken
    });
    console.log('🟢 [Refresh Token] SUCCESS', {
      hasNewAccessToken: !!response.data.accessToken,
      hasNewRefreshToken: !!response.data.refreshToken
    });
    const { accessToken: newAccessToken, refreshToken: newRefreshToken, user: updatedUser } =
      response.data;

    setAuth({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      user: updatedUser
    });

    refreshQueue.forEach((resolve) => resolve(newAccessToken));
    refreshQueue = [];
    return newAccessToken;
  } catch (error: any) {
    console.error('[Refresh Token] Failed', {
      status: error.response?.status,
      message: error.response?.data?.message,
      debug: error.response?.data?.debug,
      error: error.message
    });
    logout();
    refreshQueue.forEach((resolve) => resolve(null));
    refreshQueue = [];
    return null;
  } finally {
    isRefreshing = false;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const url = error.config?.url || '';
    
    // Never attempt token refresh for auth endpoints (login, refresh, logout)
    const isAuthEndpoint = url.includes('/auth/login') || 
                           url.includes('/auth/refresh') || 
                           url.includes('/auth/logout');
    
    // Don't retry if this is already a refresh token request or auth endpoint
    const isRefreshRequest = url.includes('/auth/refresh');
    
    if (error.response?.status === 401 && !isRefreshRequest && !isAuthEndpoint) {
      console.error('🔴 [API 401] Unauthorized, attempting token refresh', {
        url: error.config?.url,
        status: error.response.status,
        message: error.response.data?.message,
        debug: error.response.data?.debug,
        fullResponse: error.response.data
      });
      const newAccessToken = await refreshAccessToken();
      if (newAccessToken && error.config) {
        console.log('🟢 [API 401] Token refreshed, retrying request', {
          url: error.config?.url
        });
        error.config.headers = error.config.headers || {};
        error.config.headers.Authorization = `Bearer ${newAccessToken}`;
        return api.request(error.config);
      } else {
        console.error('🔴 [API 401] Token refresh failed, request cannot proceed', {
          url: error.config?.url
        });
      }
    } else if (isRefreshRequest && error.response?.status === 401) {
      // Refresh token request failed - don't retry, just log
      console.warn('🔴 [Refresh Token] Refresh failed, will logout', {
        status: error.response?.status,
        message: error.response?.data?.message
      });
    } else {
      console.error('🔴 [API Error]', {
        url: error.config?.url,
        status: error.response?.status,
        message: error.response?.data?.message,
        debug: error.response?.data?.debug
      });
    }

    return Promise.reject(error);
  }
);

export { api };
