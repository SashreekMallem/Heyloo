import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DashboardTimeRange } from '@heyloo/shared';
import { Headphones, ShoppingBag, TrendingUp, Users } from 'lucide-react';

import {
  fetchRestaurantCalls,
  fetchRestaurantOrders,
  fetchRestaurantOverview
} from '../../api/restaurants';
import { DataTable } from '../../components/DataTable';
import { MetricCard } from '../../components/MetricCard';
import { TrendAreaChart } from '../../components/charts/TrendAreaChart';
import { useAuthStore } from '../../hooks/useAuthStore';

const ranges: DashboardTimeRange[] = ['today', 'last7', 'last30'];

export function RestaurantOverviewPage() {
  const { user } = useAuthStore();
  const [range, setRange] = useState<DashboardTimeRange>('today');

  const restaurantId = user?.restaurantId;

  const overviewQuery = useQuery({
    enabled: Boolean(restaurantId),
    queryKey: ['restaurant-overview', restaurantId, range],
    queryFn: () => fetchRestaurantOverview(restaurantId!, range)
  });

  const ordersQuery = useQuery({
    enabled: Boolean(restaurantId),
    queryKey: ['restaurant-orders', restaurantId],
    queryFn: () => fetchRestaurantOrders(restaurantId!)
  });

  const callsQuery = useQuery({
    enabled: Boolean(restaurantId),
    queryKey: ['restaurant-calls', restaurantId],
    queryFn: () => fetchRestaurantCalls(restaurantId!)
  });

  const orderTrend = useMemo(() => {
    if (!ordersQuery.data) return [];
    return ordersQuery.data.slice(0, 7).map((order: any) => ({
      label: new Date(order.placed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      value: order.total
    }));
  }, [ordersQuery.data]);

  return (
    <div className="space-y-10 text-white">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.3rem] text-white/50">Restaurant HQ</p>
          <h1 className="text-4xl font-bold">Today&apos;s Performance</h1>
        </div>
        <div className="flex gap-2 bg-white/10 rounded-full p-1 border border-white/10">
          {ranges.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setRange(option)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                range === option
                  ? 'bg-white text-slate-900 shadow-lg'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              {option.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <MetricCard
          label="Orders"
          value={overviewQuery.data ? overviewQuery.data.orders.toLocaleString() : '—'}
          icon={<ShoppingBag className="h-5 w-5" />}
          accent="emerald"
        />
        <MetricCard
          label="Revenue"
          value={overviewQuery.data ? `$${overviewQuery.data.revenue.toFixed(2)}` : '—'}
          icon={<TrendingUp className="h-5 w-5" />}
          accent="indigo"
        />
        <MetricCard
          label="Calls"
          value={overviewQuery.data ? overviewQuery.data.calls.toLocaleString() : '—'}
          icon={<Headphones className="h-5 w-5" />}
          accent="sky"
          delta={overviewQuery.data ? `${overviewQuery.data.minutes} min` : undefined}
        />
        <MetricCard
          label="Delivery vs Pickup"
          value={overviewQuery.data ? `${overviewQuery.data.deliveryOrders}/${overviewQuery.data.pickupOrders}` : '—'}
          icon={<Users className="h-5 w-5" />}
          accent="amber"
        />
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div>
          <h2 className="text-lg font-semibold text-white/70 mb-4">Revenue Trend</h2>
          <TrendAreaChart data={orderTrend} color="#a855f7" />
        </div>
        <div className="glass-panel border border-white/10 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white/70">Live Call Feed</h2>
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {callsQuery.data && callsQuery.data.length > 0 ? (
              callsQuery.data.map((call: any) => (
                <div
                  key={call.id}
                  className="border border-white/10 rounded-xl px-4 py-3 bg-white/5 flex items-center justify-between"
                >
                  <div>
                    <p className="text-sm font-medium text-white">
                      {call.customer_phone ?? 'Unknown caller'}
                    </p>
                    <p className="text-xs text-white/50">
                      {new Date(call.created_at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}{' '}
                      · {call.status}
                    </p>
                  </div>
                  <span className="text-xs px-3 py-1 rounded-full bg-white/10 text-white/60">
                    {call.duration_seconds ? `${call.duration_seconds}s` : '—'}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-white/50 text-sm">No calls yet today.</p>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-white/70">Recent Orders</h2>
        <DataTable
          data={ordersQuery.data ?? []}
          columns={[
            {
              header: 'Order',
              accessor: (row: any) => (
                <div>
                  <p className="font-semibold text-white">{row.customer_name ?? row.customer_phone}</p>
                  <p className="text-xs text-white/50 uppercase tracking-widest">{row.status}</p>
                </div>
              )
            },
            {
              header: 'Type',
              accessor: (row: any) => row.order_type
            },
            {
              header: 'Total',
              accessor: (row: any) => `$${row.total.toFixed(2)}`
            },
            {
              header: 'Placed',
              accessor: (row: any) =>
                new Date(row.placed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            }
          ]}
          emptyState="No orders yet."
        />
      </section>
    </div>
  );
}
