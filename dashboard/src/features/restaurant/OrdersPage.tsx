import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Filter, RefreshCcw, ChevronRight } from 'lucide-react';

import { fetchRestaurantOrders } from '../../api/restaurants';
import { updateOrderStatus, type OrderStatus } from '../../api/orders';
import { DataTable } from '../../components/DataTable';
import { useAuthStore } from '../../hooks/useAuthStore';

export function RestaurantOrdersPage() {
  const { user } = useAuthStore();
  const [status, setStatus] = useState<'all' | string>('all');
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    enabled: Boolean(user?.restaurantId),
    queryKey: ['restaurant-orders', user?.restaurantId],
    queryFn: () => fetchRestaurantOrders(user!.restaurantId!)
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ orderId, newStatus }: { orderId: string; newStatus: OrderStatus }) =>
      updateOrderStatus(orderId, user!.restaurantId!, newStatus),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['restaurant-orders', user?.restaurantId] });
    }
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    if (status === 'all') return data;
    return data.filter((order: any) => order.status === status);
  }, [data, status]);

  return (
    <div className="space-y-8 text-white">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.3rem] text-white/50">Orders</p>
          <h1 className="text-4xl font-bold">Live Order Board</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-white/10 border border-white/10 rounded-full px-4 py-2 text-sm text-white/70">
            <Filter className="h-4 w-4 mr-2" />
            <select
              className="bg-transparent focus:outline-none"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="payment_pending">Awaiting Payment</option>
              <option value="paid">Paid</option>
              <option value="preparing">Preparing</option>
              <option value="ready">Ready</option>
              <option value="out_for_delivery">Out for delivery</option>
              <option value="delivered">Delivered</option>
              <option value="picked_up">Picked up</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 border border-white/10 text-sm text-white/70 hover:text-white hover:bg-white/20 transition-all"
          >
            <RefreshCcw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </header>

      {isLoading ? (
        <div className="glass-panel p-10 text-center text-white/60">Loading orders…</div>
      ) : null}

      <DataTable
        data={filtered}
        columns={[
          {
            header: 'Customer',
            accessor: (row: any) => (
              <div>
                <p className="font-semibold text-white">{row.customer_name ?? row.customer_phone}</p>
                <p className="text-xs uppercase tracking-widest text-white/40">{row.status}</p>
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
            header: 'Payment',
            accessor: (row: any) => row.payment_status
          },
          {
            header: 'Placed',
            accessor: (row: any) => (
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-white/40" />
                {new Date(row.placed_at).toLocaleString()}
              </div>
            )
          },
          {
            header: 'Actions',
            accessor: (row: any) => (
              <div className="flex items-center gap-2">
                <select
                  value={row.status}
                  onChange={(e) => {
                    updateStatusMutation.mutate({
                      orderId: row.id,
                      newStatus: e.target.value as OrderStatus
                    });
                  }}
                  className="bg-white/10 border border-white/20 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/30"
                  disabled={updateStatusMutation.isPending}
                >
                  <option value="pending">Pending</option>
                  <option value="payment_pending">Awaiting Payment</option>
                  <option value="paid">Paid</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="preparing">Preparing</option>
                  <option value="ready">Ready</option>
                  <option value="out_for_delivery">Out for Delivery</option>
                  <option value="delivered">Delivered</option>
                  <option value="picked_up">Picked Up</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                <ChevronRight className="h-4 w-4 text-white/40" />
              </div>
            )
          }
        ]}
        emptyState="No orders yet."
      />
    </div>
  );
}
