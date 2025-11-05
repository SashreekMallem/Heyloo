import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Headphones, Wallet, Waves } from 'lucide-react';
import type { DashboardTimeRange } from '@heyloo/shared';

import { fetchPlatformOverview, fetchRestaurantSummaries } from '../../api/platform';
import { MetricCard } from '../../components/MetricCard';
import { DataTable } from '../../components/DataTable';
import { TrendAreaChart } from '../../components/charts/TrendAreaChart';

const ranges: DashboardTimeRange[] = ['today', 'last7', 'last30', 'month_to_date'];

export function PlatformOverviewPage() {
  const [range, setRange] = useState<DashboardTimeRange>('today');

  const overviewQuery = useQuery({
    queryKey: ['platform-overview', range],
    queryFn: () => fetchPlatformOverview(range)
  });

  const topRestaurantsQuery = useQuery({
    queryKey: ['platform-restaurants', range],
    queryFn: () => fetchRestaurantSummaries(range)
  });

  const isLoading = overviewQuery.isLoading || topRestaurantsQuery.isLoading;

  const trendData =
    topRestaurantsQuery.data?.map((restaurant) => ({
      label: restaurant.restaurantName.split(' ')[0],
      value: restaurant.revenue
    })) ?? [];

  return (
    <div className="space-y-10 text-white">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.3rem] text-white/50">
            Platform Command Center
          </p>
          <h1 className="text-4xl font-bold">Global Performance Overview</h1>
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

      {isLoading ? (
        <div className="glass-panel p-10 text-center text-white/60">Loading metrics…</div>
      ) : null}

      {overviewQuery.data ? (
        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          <MetricCard
            label="Active Restaurants"
            value={`${overviewQuery.data.activeRestaurants}/${overviewQuery.data.totalRestaurants}`}
            icon={<Activity className="h-5 w-5" />}
            accent="emerald"
          />
          <MetricCard
            label="Total Calls"
            value={overviewQuery.data.totalCalls.toLocaleString()}
            icon={<Headphones className="h-5 w-5" />}
            accent="sky"
            delta={`${overviewQuery.data.totalCallMinutes.toLocaleString()} minutes`}
          />
          <MetricCard
            label="Revenue"
            value={`$${overviewQuery.data.totalRevenue.toLocaleString(undefined, {
              minimumFractionDigits: 2
            })}`}
            icon={<Wallet className="h-5 w-5" />}
            accent="indigo"
          />
          <MetricCard
            label="Net Profit"
            value={`$${overviewQuery.data.netProfit.toLocaleString(undefined, {
              minimumFractionDigits: 2
            })}`}
            icon={<Waves className="h-5 w-5" />}
            accent="amber"
            delta={`VAPI costs $${overviewQuery.data.vapiCosts.toLocaleString(undefined, {
              minimumFractionDigits: 2
            })}`}
          />
        </section>
      ) : null}

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-stretch">
        <div className="xl:col-span-2">
          <h2 className="text-lg font-semibold mb-4 text-white/70">Revenue Momentum</h2>
          <TrendAreaChart data={trendData} />
        </div>
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white/70">Today’s Highlights</h2>
          <div className="glass-panel p-6 border border-white/10 space-y-4 text-white/80">
            <div>
              <p className="text-sm text-white/50">Highest Revenue</p>
              <p className="text-xl font-semibold">
                {topRestaurantsQuery.data?.[0]?.restaurantName ?? '—'}
              </p>
            </div>
            <div>
              <p className="text-sm text-white/50">Most Calls</p>
              <p className="text-xl font-semibold">
                {topRestaurantsQuery.data
                  ?.slice()
                  .sort((a, b) => b.calls - a.calls)[0]
                  ?.restaurantName ?? '—'}
              </p>
            </div>
            <div>
              <p className="text-sm text-white/50">Top Conversion</p>
              <p className="text-xl font-semibold">
                {topRestaurantsQuery.data
                  ?.slice()
                  .sort((a, b) => b.orders - a.orders)[0]
                  ?.restaurantName ?? '—'}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-white/70">Restaurants by Usage</h2>
        <DataTable
          data={topRestaurantsQuery.data ?? []}
          columns={[
            {
              header: 'Restaurant',
              accessor: (row) => (
                <div>
                  <p className="font-medium text-white">{row.restaurantName}</p>
                  <p className="text-xs uppercase tracking-widest text-white/40">
                    {row.status}
                  </p>
                </div>
              )
            },
            {
              header: 'Calls',
              accessor: (row) => row.calls.toLocaleString()
            },
            {
              header: 'Minutes',
              accessor: (row) => row.callMinutes.toLocaleString(undefined, { maximumFractionDigits: 1 })
            },
            {
              header: 'Orders',
              accessor: (row) => row.orders.toLocaleString()
            },
            {
              header: 'Revenue',
              accessor: (row) =>
                `$${row.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
            }
          ]}
          emptyState="No usage data yet."
        />
      </section>
    </div>
  );
}
