import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Filter, RefreshCcw, ChevronRight } from 'lucide-react';
import { fetchRestaurantOrders } from '../../api/restaurants';
import { updateOrderStatus } from '../../api/orders';
import { DataTable } from '../../components/DataTable';
import { useAuthStore } from '../../hooks/useAuthStore';
export function RestaurantOrdersPage() {
    const { user } = useAuthStore();
    const [status, setStatus] = useState('all');
    const queryClient = useQueryClient();
    const { data, isLoading, refetch } = useQuery({
        enabled: Boolean(user?.restaurantId),
        queryKey: ['restaurant-orders', user?.restaurantId],
        queryFn: () => fetchRestaurantOrders(user.restaurantId)
    });
    const updateStatusMutation = useMutation({
        mutationFn: ({ orderId, newStatus }) => updateOrderStatus(orderId, user.restaurantId, newStatus),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['restaurant-orders', user?.restaurantId] });
        }
    });
    const filtered = useMemo(() => {
        if (!data)
            return [];
        if (status === 'all')
            return data;
        return data.filter((order) => order.status === status);
    }, [data, status]);
    return (_jsxs("div", { className: "space-y-8 text-white", children: [_jsxs("header", { className: "flex flex-col md:flex-row md:items-center md:justify-between gap-4", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm uppercase tracking-[0.3rem] text-white/50", children: "Orders" }), _jsx("h1", { className: "text-4xl font-bold", children: "Live Order Board" })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsxs("div", { className: "flex items-center bg-white/10 border border-white/10 rounded-full px-4 py-2 text-sm text-white/70", children: [_jsx(Filter, { className: "h-4 w-4 mr-2" }), _jsxs("select", { className: "bg-transparent focus:outline-none", value: status, onChange: (event) => setStatus(event.target.value), children: [_jsx("option", { value: "all", children: "All statuses" }), _jsx("option", { value: "pending", children: "Pending" }), _jsx("option", { value: "payment_pending", children: "Awaiting Payment" }), _jsx("option", { value: "paid", children: "Paid" }), _jsx("option", { value: "preparing", children: "Preparing" }), _jsx("option", { value: "ready", children: "Ready" }), _jsx("option", { value: "out_for_delivery", children: "Out for delivery" }), _jsx("option", { value: "delivered", children: "Delivered" }), _jsx("option", { value: "picked_up", children: "Picked up" }), _jsx("option", { value: "cancelled", children: "Cancelled" })] })] }), _jsxs("button", { type: "button", onClick: () => refetch(), className: "flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 border border-white/10 text-sm text-white/70 hover:text-white hover:bg-white/20 transition-all", children: [_jsx(RefreshCcw, { className: "h-4 w-4" }), " Refresh"] })] })] }), isLoading ? (_jsx("div", { className: "glass-panel p-10 text-center text-white/60", children: "Loading orders\u2026" })) : null, _jsx(DataTable, { data: filtered, columns: [
                    {
                        header: 'Customer',
                        accessor: (row) => (_jsxs("div", { children: [_jsx("p", { className: "font-semibold text-white", children: row.customer_name ?? row.customer_phone }), _jsx("p", { className: "text-xs uppercase tracking-widest text-white/40", children: row.status })] }))
                    },
                    {
                        header: 'Type',
                        accessor: (row) => row.order_type
                    },
                    {
                        header: 'Total',
                        accessor: (row) => `$${row.total.toFixed(2)}`
                    },
                    {
                        header: 'Payment',
                        accessor: (row) => row.payment_status
                    },
                    {
                        header: 'Placed',
                        accessor: (row) => (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Clock, { className: "h-4 w-4 text-white/40" }), new Date(row.placed_at).toLocaleString()] }))
                    },
                    {
                        header: 'Actions',
                        accessor: (row) => (_jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("select", { value: row.status, onChange: (e) => {
                                        updateStatusMutation.mutate({
                                            orderId: row.id,
                                            newStatus: e.target.value
                                        });
                                    }, className: "bg-white/10 border border-white/20 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/30", disabled: updateStatusMutation.isPending, children: [_jsx("option", { value: "pending", children: "Pending" }), _jsx("option", { value: "payment_pending", children: "Awaiting Payment" }), _jsx("option", { value: "paid", children: "Paid" }), _jsx("option", { value: "confirmed", children: "Confirmed" }), _jsx("option", { value: "preparing", children: "Preparing" }), _jsx("option", { value: "ready", children: "Ready" }), _jsx("option", { value: "out_for_delivery", children: "Out for Delivery" }), _jsx("option", { value: "delivered", children: "Delivered" }), _jsx("option", { value: "picked_up", children: "Picked Up" }), _jsx("option", { value: "cancelled", children: "Cancelled" })] }), _jsx(ChevronRight, { className: "h-4 w-4 text-white/40" })] }))
                    }
                ], emptyState: "No orders yet." })] }));
}
