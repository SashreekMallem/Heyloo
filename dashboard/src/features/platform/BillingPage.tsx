import { useQuery } from '@tanstack/react-query';
import { CreditCard, DollarSign, LineChart } from 'lucide-react';
import type { DashboardTimeRange } from '@heyloo/shared';
import { useState } from 'react';

import { fetchPlatformOverview, fetchRestaurantSummaries } from '../../api/platform';
import { DataTable } from '../../components/DataTable';
import { MetricCard } from '../../components/MetricCard';

const ranges: DashboardTimeRange[] = ['month_to_date', 'last30', 'year_to_date'];

export function PlatformBillingPage() {
  const [range, setRange] = useState<DashboardTimeRange>('month_to_date');

  const overviewQuery = useQuery({
    queryKey: ['platform-overview', range],
    queryFn: () => fetchPlatformOverview(range)
  });

  const restaurantsQuery = useQuery({
    queryKey: ['platform-restaurants', range],
    queryFn: () => fetchRestaurantSummaries(range)
  });

  const totalRevenue = overviewQuery.data?.totalRevenue ?? 0;
  const vapiCosts = overviewQuery.data?.vapiCosts ?? 0;
  const netProfit = overviewQuery.data?.netProfit ?? 0;

  return (
    <div className="space-y-10 text-white">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.3rem] text-white/50">Billing Intelligence</p>
          <h1 className="text-4xl font-bold">Recurring Revenue & Usage Billing</h1>
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

      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <MetricCard
          label="MRR"
          value={`$${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
          icon={<DollarSign className="h-5 w-5" />}
          accent="indigo"
        />
        <MetricCard
          label="Usage Costs"
          value={`$${vapiCosts.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
          icon={<LineChart className="h-5 w-5" />}
          accent="rose"
        />
        <MetricCard
          label="Net Margin"
          value={`$${netProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
          icon={<CreditCard className="h-5 w-5" />}
          accent="emerald"
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-white/70">Restaurant Billing Detail</h2>
        <DataTable
          data={restaurantsQuery.data ?? []}
          columns={[
            {
              header: 'Restaurant',
              accessor: (row) => (
                <div>
                  <p className="font-semibold text-white">{row.restaurantName}</p>
                  <p className="text-xs uppercase tracking-widest text-white/40">{row.status}</p>
                </div>
              )
            },
          {
            header: 'Revenue',
            accessor: (row) =>
              `$${row.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
          },
            {
              header: 'Orders',
              accessor: (row) => row.orders.toLocaleString()
            },
            {
              header: 'Calls',
              accessor: (row) => row.calls.toLocaleString()
            }
          ]}
          emptyState="No billing activity this period."
        />
      </section>
    </div>
  );
}
