import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Filter, RefreshCcw, ChevronRight } from 'lucide-react';

import { fetchRestaurantOrders, fetchRestaurantDetails, createManualOrder } from '../../api/restaurants';
import { updateOrderStatus, type OrderStatus } from '../../api/orders';
import { DataTable } from '../../components/DataTable';
import { useAuthStore } from '../../hooks/useAuthStore';

export function RestaurantOrdersPage() {
  const { user } = useAuthStore();
  const [status, setStatus] = useState<'all' | string>('all');
  const queryClient = useQueryClient();
  const [showManualOrderForm, setShowManualOrderForm] = useState(false);
  const [manualOrderForm, setManualOrderForm] = useState({
    customerName: '',
    customerPhone: '',
    orderType: 'pickup',
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    deliveryFee: ''
  });
  const [manualItems, setManualItems] = useState<Array<{ name: string; price: string; quantity: number }>>([
    { name: '', price: '', quantity: 1 }
  ]);

  const { data: restaurantDetails } = useQuery({
    enabled: Boolean(user?.restaurantId),
    queryKey: ['restaurant-details', user?.restaurantId],
    queryFn: () => fetchRestaurantDetails(user!.restaurantId!)
  });

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

  const manualMode = Boolean(restaurantDetails?.manual_mode);

  const createManualOrderMutation = useMutation({
    mutationFn: () =>
      createManualOrder(user!.restaurantId!, {
        customerName: manualOrderForm.customerName || undefined,
        customerPhone: manualOrderForm.customerPhone || undefined,
        orderType: manualOrderForm.orderType,
        paymentMethod: manualOrderForm.paymentMethod,
        paymentStatus: manualOrderForm.paymentStatus,
        deliveryFee: manualOrderForm.deliveryFee ? Number(manualOrderForm.deliveryFee) : undefined,
        items: manualItems
          .filter((item) => item.name && Number(item.price) > 0)
          .map((item) => ({
            name: item.name,
            price: Number(item.price),
            quantity: item.quantity
          }))
      }),
    onSuccess: () => {
      setShowManualOrderForm(false);
      setManualOrderForm({ customerName: '', customerPhone: '', orderType: 'pickup', paymentMethod: 'cash', paymentStatus: 'paid', deliveryFee: '' });
      setManualItems([{ name: '', price: '', quantity: 1 }]);
      queryClient.invalidateQueries({ queryKey: ['restaurant-orders', user?.restaurantId] });
    },
    onError: (error: any) => {
      alert(`Failed to log order: ${error.response?.data?.message || error.message}`);
    }
  });

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
          {manualMode && (
            <button
              type="button"
              onClick={() => setShowManualOrderForm(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-white text-slate-900 hover:bg-white/90 transition-all font-medium"
            >
              Log Order
            </button>
          )}
        </div>
      </header>

      {manualMode && showManualOrderForm && (
        <section className="glass-panel p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white/90">Log Manual Order</h3>
            <button
              type="button"
              onClick={() => setShowManualOrderForm(false)}
              className="text-white/60 hover:text-white"
            >
              Close
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-1 text-sm text-white/70">
              Customer Name
              <input
                className="w-full rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-white"
                value={manualOrderForm.customerName}
                onChange={(event) => setManualOrderForm((prev) => ({ ...prev, customerName: event.target.value }))}
              />
            </label>
            <label className="space-y-1 text-sm text-white/70">
              Customer Phone
              <input
                className="w-full rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-white"
                value={manualOrderForm.customerPhone}
                onChange={(event) => setManualOrderForm((prev) => ({ ...prev, customerPhone: event.target.value }))}
              />
            </label>
            <label className="space-y-1 text-sm text-white/70">
              Order Type
              <select
                className="w-full rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-white"
                value={manualOrderForm.orderType}
                onChange={(event) => setManualOrderForm((prev) => ({ ...prev, orderType: event.target.value }))}
              >
                <option value="pickup">Pickup</option>
                <option value="delivery">Delivery</option>
              </select>
            </label>
            <label className="space-y-1 text-sm text-white/70">
              Delivery Fee
              <input
                type="number"
                step="0.01"
                className="w-full rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-white"
                value={manualOrderForm.deliveryFee}
                onChange={(event) => setManualOrderForm((prev) => ({ ...prev, deliveryFee: event.target.value }))}
              />
            </label>
            <label className="space-y-1 text-sm text-white/70">
              Payment Method
              <select
                className="w-full rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-white"
                value={manualOrderForm.paymentMethod}
                onChange={(event) => setManualOrderForm((prev) => ({ ...prev, paymentMethod: event.target.value }))}
              >
                <option value="cash">Cash</option>
                <option value="card_on_delivery">Card on Delivery</option>
                <option value="stripe_link">Stripe Link</option>
              </select>
            </label>
            <label className="space-y-1 text-sm text-white/70">
              Payment Status
              <select
                className="w-full rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-white"
                value={manualOrderForm.paymentStatus}
                onChange={(event) => setManualOrderForm((prev) => ({ ...prev, paymentStatus: event.target.value }))}
              >
                <option value="paid">Paid</option>
                <option value="pending">Pending</option>
                <option value="failed">Failed</option>
                <option value="refunded">Refunded</option>
              </select>
            </label>
          </div>
          <div className="space-y-2">
            <p className="text-sm text-white/70">Items</p>
            {manualItems.map((item, index) => (
              <div key={index} className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <input
                  placeholder="Name"
                  className="rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-white"
                  value={item.name}
                  onChange={(event) => {
                    const next = [...manualItems];
                    next[index].name = event.target.value;
                    setManualItems(next);
                  }}
                />
                <input
                  type="number"
                  step="0.01"
                  placeholder="Price"
                  className="rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-white"
                  value={item.price}
                  onChange={(event) => {
                    const next = [...manualItems];
                    next[index].price = event.target.value;
                    setManualItems(next);
                  }}
                />
                <input
                  type="number"
                  min={1}
                  placeholder="Qty"
                  className="rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-white"
                  value={item.quantity}
                  onChange={(event) => {
                    const next = [...manualItems];
                    next[index].quantity = Number(event.target.value) || 1;
                    setManualItems(next);
                  }}
                />
                <button
                  type="button"
                  onClick={() => setManualItems((prev) => prev.filter((_, idx) => idx !== index))}
                  className="rounded-lg bg-rose-500/20 text-rose-200"
                  disabled={manualItems.length === 1}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setManualItems((prev) => [...prev, { name: '', price: '', quantity: 1 }])}
              className="px-3 py-1 rounded-full bg-white/10 border border-white/10 text-sm"
            >
              Add Item
            </button>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => createManualOrderMutation.mutate()}
              className="px-4 py-2 rounded-full bg-white text-slate-900"
              disabled={createManualOrderMutation.isPending}
            >
              {createManualOrderMutation.isPending ? 'Saving…' : 'Save Order'}
            </button>
            <button
              type="button"
              onClick={() => setShowManualOrderForm(false)}
              className="px-4 py-2 rounded-full bg-white/10 border border-white/10"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

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
