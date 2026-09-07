import { useQuery } from '@tanstack/react-query';
import { PhoneCall, PhoneIncoming, PhoneOff } from 'lucide-react';

import { fetchRestaurantCalls } from '../../api/restaurants';
import { DataTable } from '../../components/DataTable';
import { MetricCard } from '../../components/MetricCard';
import { useAuthStore } from '../../hooks/useAuthStore';

export function RestaurantCallsPage() {
  const { user } = useAuthStore();

  const { data } = useQuery({
    enabled: Boolean(user?.restaurantId),
    queryKey: ['restaurant-calls', user?.restaurantId],
    queryFn: () => fetchRestaurantCalls(user!.restaurantId!)
  });

  const totalCalls = data?.length ?? 0;
  const completed = data?.filter((call: any) => call.status === 'completed').length ?? 0;
  const failed = data?.filter((call: any) => call.status === 'failed').length ?? 0;

  return (
    <div className="space-y-10 text-white">
      <header>
        <p className="text-sm uppercase tracking-[0.3rem] text-white/50">Call Intelligence</p>
        <h1 className="text-4xl font-bold">Voice Assistant Sessions</h1>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <MetricCard label="Total Calls" value={totalCalls} icon={<PhoneCall className="h-5 w-5" />} accent="indigo" />
        <MetricCard label="Completed" value={completed} icon={<PhoneIncoming className="h-5 w-5" />} accent="emerald" />
        <MetricCard label="Failed" value={failed} icon={<PhoneOff className="h-5 w-5" />} accent="rose" />
      </section>

      <DataTable
        data={data ?? []}
        columns={[
          {
            header: 'Caller',
            accessor: (row: any) => row.customer_phone ?? 'Unknown'
          },
          {
            header: 'Status',
            accessor: (row: any) => row.status
          },
          {
            header: 'Duration',
            accessor: (row: any) => (row.duration_seconds ? `${row.duration_seconds}s` : '—')
          },
          {
            header: 'Timestamp',
            accessor: (row: any) => new Date(row.created_at).toLocaleString()
          }
        ]}
        emptyState="No call logs yet."
      />
    </div>
  );
}
