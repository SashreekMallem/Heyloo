import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Headphones, ShoppingBag, TrendingUp, Users } from 'lucide-react';
import { fetchRestaurantCalls, fetchRestaurantOrders, fetchRestaurantOverview } from '../../api/restaurants';
import { DataTable } from '../../components/DataTable';
import { MetricCard } from '../../components/MetricCard';
import { TrendAreaChart } from '../../components/charts/TrendAreaChart';
import { useAuthStore } from '../../hooks/useAuthStore';
const ranges = ['today', 'last7', 'last30'];
export function RestaurantOverviewPage() {
    const { user } = useAuthStore();
    const [range, setRange] = useState('today');
    const restaurantId = user?.restaurantId;
    const overviewQuery = useQuery({
        enabled: Boolean(restaurantId),
        queryKey: ['restaurant-overview', restaurantId, range],
        queryFn: () => fetchRestaurantOverview(restaurantId, range)
    });
    const ordersQuery = useQuery({
        enabled: Boolean(restaurantId),
        queryKey: ['restaurant-orders', restaurantId],
        queryFn: () => fetchRestaurantOrders(restaurantId)
    });
    const callsQuery = useQuery({
        enabled: Boolean(restaurantId),
        queryKey: ['restaurant-calls', restaurantId],
        queryFn: () => fetchRestaurantCalls(restaurantId)
    });
    const orderTrend = useMemo(() => {
        if (!ordersQuery.data)
            return [];
        return ordersQuery.data.slice(0, 7).map((order) => ({
            label: new Date(order.placed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            value: order.total
        }));
    }, [ordersQuery.data]);
    return (_jsxs("div", { className: "space-y-10 text-white", children: [_jsxs("header", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm uppercase tracking-[0.3rem] text-white/50", children: "Restaurant HQ" }), _jsx("h1", { className: "text-4xl font-bold", children: "Today's Performance" })] }), _jsx("div", { className: "flex gap-2 bg-white/10 rounded-full p-1 border border-white/10", children: ranges.map((option) => (_jsx("button", { type: "button", onClick: () => setRange(option), className: `px-4 py-2 rounded-full text-sm font-medium transition-all ${range === option
                                ? 'bg-white text-slate-900 shadow-lg'
                                : 'text-white/60 hover:text-white'}`, children: option.replace(/_/g, ' ') }, option))) })] }), _jsxs("section", { className: "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6", children: [_jsx(MetricCard, { label: "Orders", value: overviewQuery.data ? overviewQuery.data.orders.toLocaleString() : '—', icon: _jsx(ShoppingBag, { className: "h-5 w-5" }), accent: "emerald" }), _jsx(MetricCard, { label: "Revenue", value: overviewQuery.data ? `$${overviewQuery.data.revenue.toFixed(2)}` : '—', icon: _jsx(TrendingUp, { className: "h-5 w-5" }), accent: "indigo" }), _jsx(MetricCard, { label: "Calls", value: overviewQuery.data ? overviewQuery.data.calls.toLocaleString() : '—', icon: _jsx(Headphones, { className: "h-5 w-5" }), accent: "sky", delta: overviewQuery.data ? `${overviewQuery.data.minutes} min` : undefined }), _jsx(MetricCard, { label: "Delivery vs Pickup", value: overviewQuery.data ? `${overviewQuery.data.deliveryOrders}/${overviewQuery.data.pickupOrders}` : '—', icon: _jsx(Users, { className: "h-5 w-5" }), accent: "amber" })] }), _jsxs("section", { className: "grid grid-cols-1 xl:grid-cols-2 gap-6", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-lg font-semibold text-white/70 mb-4", children: "Revenue Trend" }), _jsx(TrendAreaChart, { data: orderTrend, color: "#a855f7" })] }), _jsxs("div", { className: "glass-panel border border-white/10 p-6 space-y-4", children: [_jsx("h2", { className: "text-lg font-semibold text-white/70", children: "Live Call Feed" }), _jsx("div", { className: "space-y-3 max-h-64 overflow-y-auto", children: callsQuery.data && callsQuery.data.length > 0 ? (callsQuery.data.map((call) => (_jsxs("div", { className: "border border-white/10 rounded-xl px-4 py-3 bg-white/5 flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm font-medium text-white", children: call.customer_phone ?? 'Unknown caller' }), _jsxs("p", { className: "text-xs text-white/50", children: [new Date(call.created_at).toLocaleTimeString([], {
                                                            hour: '2-digit',
                                                            minute: '2-digit'
                                                        }), ' ', "\u00B7 ", call.status] })] }), _jsx("span", { className: "text-xs px-3 py-1 rounded-full bg-white/10 text-white/60", children: call.duration_seconds ? `${call.duration_seconds}s` : '—' })] }, call.id)))) : (_jsx("p", { className: "text-white/50 text-sm", children: "No calls yet today." })) })] })] }), _jsxs("section", { className: "space-y-4", children: [_jsx("h2", { className: "text-lg font-semibold text-white/70", children: "Recent Orders" }), _jsx(DataTable, { data: ordersQuery.data ?? [], columns: [
                            {
                                header: 'Order',
                                accessor: (row) => (_jsxs("div", { children: [_jsx("p", { className: "font-semibold text-white", children: row.customer_name ?? row.customer_phone }), _jsx("p", { className: "text-xs text-white/50 uppercase tracking-widest", children: row.status })] }))
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
                                header: 'Placed',
                                accessor: (row) => new Date(row.placed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            }
                        ], emptyState: "No orders yet." })] })] }));
}
