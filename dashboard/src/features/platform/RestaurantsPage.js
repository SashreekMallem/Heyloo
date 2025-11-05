import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchRestaurantSummaries } from '../../api/platform';
import { DataTable } from '../../components/DataTable';
const ranges = ['today', 'last7', 'last30', 'month_to_date'];
export function PlatformRestaurantsPage() {
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('all');
    const [range, setRange] = useState('last7');
    const { data, isLoading } = useQuery({
        queryKey: ['platform-restaurants', range],
        queryFn: () => fetchRestaurantSummaries(range)
    });
    const filtered = useMemo(() => {
        if (!data)
            return [];
        return data.filter((restaurant) => {
            const matchesSearch = restaurant.restaurantName
                .toLowerCase()
                .includes(search.toLowerCase());
            const matchesStatus = status === 'all' || restaurant.status === status;
            return matchesSearch && matchesStatus;
        });
    }, [data, search, status]);
    return (_jsxs("div", { className: "space-y-8 text-white", children: [_jsxs("header", { className: "flex flex-col md:flex-row md:items-center md:justify-between gap-6", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm uppercase tracking-[0.3rem] text-white/50", children: "Restaurant Ops" }), _jsx("h1", { className: "text-4xl font-bold", children: "Tenant Performance" })] }), _jsxs("div", { className: "flex flex-wrap gap-3 items-center", children: [_jsx("div", { className: "bg-white/10 border border-white/10 rounded-full p-1 flex", children: ranges.map((option) => (_jsx("button", { type: "button", onClick: () => setRange(option), className: `px-4 py-2 rounded-full text-sm font-medium transition-all ${range === option
                                        ? 'bg-white text-slate-900 shadow-lg'
                                        : 'text-white/60 hover:text-white'}`, children: option.replace(/_/g, ' ') }, option))) }), _jsxs("select", { className: "bg-white/10 border border-white/10 rounded-full px-4 py-2 text-sm text-white/80 focus:outline-none", value: status, onChange: (event) => setStatus(event.target.value), children: [_jsx("option", { value: "all", children: "All statuses" }), _jsx("option", { value: "trial", children: "Trial" }), _jsx("option", { value: "active", children: "Active" }), _jsx("option", { value: "cancelled", children: "Cancelled" })] }), _jsx("input", { className: "bg-white/10 border border-white/10 rounded-full px-4 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none", placeholder: "Search restaurants\u2026", value: search, onChange: (event) => setSearch(event.target.value) })] })] }), isLoading ? (_jsx("div", { className: "glass-panel p-10 text-center text-white/60", children: "Loading data\u2026" })) : null, _jsx(DataTable, { data: filtered, columns: [
                    {
                        header: 'Restaurant',
                        accessor: (row) => (_jsxs("div", { children: [_jsx("p", { className: "font-semibold text-white", children: row.restaurantName }), _jsx("p", { className: "text-xs uppercase tracking-widest text-white/40", children: row.status })] }))
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
                        accessor: (row) => `$${row.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                    }
                ], emptyState: "No restaurants match your filters." })] }));
}
