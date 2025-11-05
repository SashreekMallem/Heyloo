import type { PosMenuItem, PosOrderItem, PosProvider } from '@heyloo/shared';

export type PosSyncResult = {
  provider: PosProvider;
  restaurantId: string;
  menuItems: PosMenuItem[];
  syncedAt: string;
};

export interface PosIntegration {
  readonly provider: Exclude<PosProvider, 'none'>;
  pullMenu(restaurantExternalId: string, accessToken?: string): Promise<PosMenuItem[]>;
  pushOrder(options: {
    restaurantExternalId: string;
    orderId: string;
    items: PosOrderItem[];
    total: number;
    customerPhone?: string;
    customerName?: string;
    orderType?: 'delivery' | 'pickup' | 'dine_in';
    deliveryAddress?: string;
    accessToken?: string; // For multi-location support - location-specific token
  }): Promise<{ externalOrderId: string }>;
}

export class NullPosIntegration implements PosIntegration {
  readonly provider = 'square' as const;

  async pullMenu(): Promise<PosMenuItem[]> {
    return [];
  }

  async pushOrder() {
    return { externalOrderId: 'stub-order' };
  }
}
