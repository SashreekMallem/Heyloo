import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Headphones, Wallet, Waves } from 'lucide-react';
import { fetchPlatformOverview, fetchRestaurantSummaries } from '../../api/platform';
import { MetricCard } from '../../components/MetricCard';
import { DataTable } from '../../components/DataTable';
import { TrendAreaChart } from '../../components/charts/TrendAreaChart';
const ranges = ['today', 'last7', 'last30', 'month_to_date'];
export function PlatformOverviewPage() {
    const [range, setRange] = useState('today');
    const overviewQuery = useQuery({
        queryKey: ['platform-overview', range],
        queryFn: () => fetchPlatformOverview(range)
    });
    const topRestaurantsQuery = useQuery({
        queryKey: ['platform-restaurants', range],
        queryFn: () => fetchRestaurantSummaries(range)
    });
    const isLoading = overviewQuery.isLoading || topRestaurantsQuery.isLoading;
    const trendData = topRestaurantsQuery.data?.map((restaurant) => ({
        label: restaurant.restaurantName.split(' ')[0],
        value: restaurant.revenue
    })) ?? [];
    return (_jsxs("div", { className: "space-y-10 text-white", children: [_jsxs("header", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm uppercase tracking-[0.3rem] text-white/50", children: "Platform Command Center" }), _jsx("h1", { className: "text-4xl font-bold", children: "Global Performance Overview" })] }), _jsx("div", { className: "flex gap-2 bg-white/10 rounded-full p-1 border border-white/10", children: ranges.map((option) => (_jsx("button", { type: "button", onClick: () => setRange(option), className: `px-4 py-2 rounded-full text-sm font-medium transition-all ${range === option
                                ? 'bg-white text-slate-900 shadow-lg'
                                : 'text-white/60 hover:text-white'}`, children: option.replace(/_/g, ' ') }, option))) })] }), isLoading ? (_jsx("div", { className: "glass-panel p-10 text-center text-white/60", children: "Loading metrics\u2026" })) : null, overviewQuery.data ? (_jsxs("section", { className: "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6", children: [_jsx(MetricCard, { label: "Active Restaurants", value: `${overviewQuery.data.activeRestaurants}/${overviewQuery.data.totalRestaurants}`, icon: _jsx(Activity, { className: "h-5 w-5" }), accent: "emerald" }), _jsx(MetricCard, { label: "Total Calls", value: overviewQuery.data.totalCalls.toLocaleString(), icon: _jsx(Headphones, { className: "h-5 w-5" }), accent: "sky", delta: `${overviewQuery.data.totalCallMinutes.toLocaleString()} minutes` }), _jsx(MetricCard, { label: "Revenue", value: `$${overviewQuery.data.totalRevenue.toLocaleString(undefined, {
                            minimumFractionDigits: 2
                        })}`, icon: _jsx(Wallet, { className: "h-5 w-5" }), accent: "indigo" }), _jsx(MetricCard, { label: "Net Profit", value: `$${overviewQuery.data.netProfit.toLocaleString(undefined, {
                            minimumFractionDigits: 2
                        })}`, icon: _jsx(Waves, { className: "h-5 w-5" }), accent: "amber", delta: `VAPI costs $${overviewQuery.data.vapiCosts.toLocaleString(undefined, {
                            minimumFractionDigits: 2
                        })}` })] })) : null, _jsxs("section", { className: "grid grid-cols-1 xl:grid-cols-3 gap-6 items-stretch", children: [_jsxs("div", { className: "xl:col-span-2", children: [_jsx("h2", { className: "text-lg font-semibold mb-4 text-white/70", children: "Revenue Momentum" }), _jsx(TrendAreaChart, { data: trendData })] }), _jsxs("div", { className: "space-y-4", children: [_jsx("h2", { className: "text-lg font-semibold text-white/70", children: "Today\u2019s Highlights" }), _jsxs("div", { className: "glass-panel p-6 border border-white/10 space-y-4 text-white/80", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm text-white/50", children: "Highest Revenue" }), _jsx("p", { className: "text-xl font-semibold", children: topRestaurantsQuery.data?.[0]?.restaurantName ?? '—' })] }), _jsxs("div", { children: [_jsx("p", { className: "text-sm text-white/50", children: "Most Calls" }), _jsx("p", { className: "text-xl font-semibold", children: topRestaurantsQuery.data
                                                    ?.slice()
                                                    .sort((a, b) => b.calls - a.calls)[0]
                                                    ?.restaurantName ?? '—' })] }), _jsxs("div", { children: [_jsx("p", { className: "text-sm text-white/50", children: "Top Conversion" }), _jsx("p", { className: "text-xl font-semibold", children: topRestaurantsQuery.data
                                                    ?.slice()
                                                    .sort((a, b) => b.orders - a.orders)[0]
                                                    ?.restaurantName ?? '—' })] })] })] })] }), _jsxs("section", { className: "space-y-4", children: [_jsx("h2", { className: "text-lg font-semibold text-white/70", children: "Restaurants by Usage" }), _jsx(DataTable, { data: topRestaurantsQuery.data ?? [], columns: [
                            {
                                header: 'Restaurant',
                                accessor: (row) => (_jsxs("div", { children: [_jsx("p", { className: "font-medium text-white", children: row.restaurantName }), _jsx("p", { className: "text-xs uppercase tracking-widest text-white/40", children: row.status })] }))
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
                                accessor: (row) => `$${row.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                            }
                        ], emptyState: "No usage data yet." })] })] }));
}
