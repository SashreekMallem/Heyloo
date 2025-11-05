import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DashboardTimeRange } from '@heyloo/shared';

import { fetchRestaurantSummaries } from '../../api/platform';
import { DataTable } from '../../components/DataTable';

const ranges: DashboardTimeRange[] = ['today', 'last7', 'last30', 'month_to_date'];

export function PlatformRestaurantsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'trial' | 'cancelled'>('all');
  const [range, setRange] = useState<DashboardTimeRange>('last7');

  const { data, isLoading } = useQuery({
    queryKey: ['platform-restaurants', range],
    queryFn: () => fetchRestaurantSummaries(range)
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.filter((restaurant) => {
      const matchesSearch = restaurant.restaurantName
        .toLowerCase()
        .includes(search.toLowerCase());
      const matchesStatus = status === 'all' || restaurant.status === status;
      return matchesSearch && matchesStatus;
    });
  }, [data, search, status]);

  return (
    <div className="space-y-8 text-white">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div>
          <p className="text-sm uppercase tracking-[0.3rem] text-white/50">Restaurant Ops</p>
          <h1 className="text-4xl font-bold">Tenant Performance</h1>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <div className="bg-white/10 border border-white/10 rounded-full p-1 flex">
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
          <select
            className="bg-white/10 border border-white/10 rounded-full px-4 py-2 text-sm text-white/80 focus:outline-none"
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="all">All statuses</option>
            <option value="trial">Trial</option>
            <option value="active">Active</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <input
            className="bg-white/10 border border-white/10 rounded-full px-4 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none"
            placeholder="Search restaurants…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </header>

      {isLoading ? (
        <div className="glass-panel p-10 text-center text-white/60">Loading data…</div>
      ) : null}

      <DataTable
        data={filtered}
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
            header: 'Calls',
            accessor: (row) => row.calls.toLocaleString()
          },
          {
            header: 'Minutes',
            accessor: (row) => row.callMinutes.toLocaleString()
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
        emptyState="No restaurants match your filters."
      />
    </div>
  );
}
