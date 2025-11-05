import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
        queryFn: () => fetchRestaurantCalls(user.restaurantId)
    });
    const totalCalls = data?.length ?? 0;
    const completed = data?.filter((call) => call.status === 'completed').length ?? 0;
    const failed = data?.filter((call) => call.status === 'failed').length ?? 0;
    return (_jsxs("div", { className: "space-y-10 text-white", children: [_jsxs("header", { children: [_jsx("p", { className: "text-sm uppercase tracking-[0.3rem] text-white/50", children: "Call Intelligence" }), _jsx("h1", { className: "text-4xl font-bold", children: "Voice Assistant Sessions" })] }), _jsxs("section", { className: "grid grid-cols-1 md:grid-cols-3 gap-6", children: [_jsx(MetricCard, { label: "Total Calls", value: totalCalls, icon: _jsx(PhoneCall, { className: "h-5 w-5" }), accent: "indigo" }), _jsx(MetricCard, { label: "Completed", value: completed, icon: _jsx(PhoneIncoming, { className: "h-5 w-5" }), accent: "emerald" }), _jsx(MetricCard, { label: "Failed", value: failed, icon: _jsx(PhoneOff, { className: "h-5 w-5" }), accent: "rose" })] }), _jsx(DataTable, { data: data ?? [], columns: [
                    {
                        header: 'Caller',
                        accessor: (row) => row.customer_phone ?? 'Unknown'
                    },
                    {
                        header: 'Status',
                        accessor: (row) => row.status
                    },
                    {
                        header: 'Duration',
                        accessor: (row) => (row.duration_seconds ? `${row.duration_seconds}s` : '—')
                    },
                    {
                        header: 'Timestamp',
                        accessor: (row) => new Date(row.created_at).toLocaleString()
                    }
                ], emptyState: "No call logs yet." })] }));
}
