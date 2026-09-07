import { api } from './client';

export type OnboardingPayload = {
  restaurantName: string;
  restaurantSlug?: string;
  ownerEmail: string;
  phoneNumber?: string;
  taxRate?: number;
  deliveryFee?: number;
  adminPassword: string;
  posType?: 'square' | 'toast' | 'clover' | 'none';
  posAccessToken?: string;
  posRefreshToken?: string;
  posLocationId?: string;
  posMerchantId?: string;
  stripeAccountId?: string;
};

export type OnboardingResult = {
  success: boolean;
  restaurant: {
    id: string;
    name: string;
    slug: string;
    phone_number: string | null;
  };
  admin: {
    id: string;
    email: string;
  };
  auth: {
    accessToken: string;
    refreshToken: string;
  };
  configuration: {
    posConfigured: boolean;
    stripeConfigured: boolean;
    vapiPhoneProvisioned: boolean;
  };
};

export async function onboardRestaurant(payload: OnboardingPayload): Promise<OnboardingResult> {
  const { data } = await api.post('/onboarding/onboard', payload);
  return data;
}

export async function checkSlugAvailability(slug: string): Promise<boolean> {
  const { data } = await api.get(`/onboarding/check-slug/${slug}`);
  return data.available;
}

export async function checkEmailAvailability(email: string): Promise<boolean> {
  const { data } = await api.get(`/onboarding/check-email/${email}`);
  return data.available;
}

export async function initiatePosAuth(
  posType: 'square' | 'toast' | 'clover',
  restaurantId: string
): Promise<{ authUrl: string }> {
  console.log('🔵 [initiatePosAuth] Calling API', { posType, restaurantId });
  
  if (!restaurantId || restaurantId.trim() === '') {
    throw new Error('Restaurant ID is required');
  }

  try {
    const { data } = await api.get(`/onboarding/pos/${posType}/auth`, {
      params: { restaurantId }
    });
    console.log('🟢 [initiatePosAuth] Success', { hasAuthUrl: !!data?.authUrl });
    return data;
  } catch (error: any) {
    console.error('🔴 [initiatePosAuth] Failed', {
      status: error.response?.status,
      message: error.response?.data?.error || error.message,
      posType,
      restaurantId
    });
    throw error;
  }
}

export async function getPosLocations(
  provider: 'square' | 'clover',
  sessionId: string
): Promise<{ locations?: any[]; merchants?: any[] }> {
  const { data } = await api.get(`/onboarding/pos/${provider}/locations`, {
    params: { session: sessionId }
  });
  return data;
}

export async function finalizePosConnection(
  provider: 'square' | 'toast' | 'clover',
  sessionId: string,
  locationIds?: string[],
  merchantIds?: string[]
): Promise<{ success: boolean; message: string; connectedCount: number }> {
  const { data } = await api.post(`/onboarding/pos/${provider}/finalize`, {
    session: sessionId,
    locationIds,
    merchantIds
  });
  return data;
}

