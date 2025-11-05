import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from '@tanstack/react-query';
import { CreditCard, DollarSign, LineChart } from 'lucide-react';
import { useState } from 'react';
import { fetchPlatformOverview, fetchRestaurantSummaries } from '../../api/platform';
import { DataTable } from '../../components/DataTable';
import { MetricCard } from '../../components/MetricCard';
const ranges = ['month_to_date', 'last30', 'year_to_date'];
export function PlatformBillingPage() {
    const [range, setRange] = useState('month_to_date');
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
    return (_jsxs("div", { className: "space-y-10 text-white", children: [_jsxs("header", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm uppercase tracking-[0.3rem] text-white/50", children: "Billing Intelligence" }), _jsx("h1", { className: "text-4xl font-bold", children: "Recurring Revenue & Usage Billing" })] }), _jsx("div", { className: "flex gap-2 bg-white/10 rounded-full p-1 border border-white/10", children: ranges.map((option) => (_jsx("button", { type: "button", onClick: () => setRange(option), className: `px-4 py-2 rounded-full text-sm font-medium transition-all ${range === option
                                ? 'bg-white text-slate-900 shadow-lg'
                                : 'text-white/60 hover:text-white'}`, children: option.replace(/_/g, ' ') }, option))) })] }), _jsxs("section", { className: "grid grid-cols-1 md:grid-cols-3 gap-6", children: [_jsx(MetricCard, { label: "MRR", value: `$${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, icon: _jsx(DollarSign, { className: "h-5 w-5" }), accent: "indigo" }), _jsx(MetricCard, { label: "Usage Costs", value: `$${vapiCosts.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, icon: _jsx(LineChart, { className: "h-5 w-5" }), accent: "rose" }), _jsx(MetricCard, { label: "Net Margin", value: `$${netProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, icon: _jsx(CreditCard, { className: "h-5 w-5" }), accent: "emerald" })] }), _jsxs("section", { className: "space-y-4", children: [_jsx("h2", { className: "text-lg font-semibold text-white/70", children: "Restaurant Billing Detail" }), _jsx(DataTable, { data: restaurantsQuery.data ?? [], columns: [
                            {
                                header: 'Restaurant',
                                accessor: (row) => (_jsxs("div", { children: [_jsx("p", { className: "font-semibold text-white", children: row.restaurantName }), _jsx("p", { className: "text-xs uppercase tracking-widest text-white/40", children: row.status })] }))
                            },
                            {
                                header: 'Revenue',
                                accessor: (row) => `$${row.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                            },
                            {
                                header: 'Orders',
                                accessor: (row) => row.orders.toLocaleString()
                            },
                            {
                                header: 'Calls',
                                accessor: (row) => row.calls.toLocaleString()
                            }
                        ], emptyState: "No billing activity this period." })] })] }));
}
