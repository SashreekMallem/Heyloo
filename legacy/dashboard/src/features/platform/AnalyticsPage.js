import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GaugeCircle, Headphones, Timer, Users } from 'lucide-react';
import { fetchCallCenterMetrics, fetchUsageTimeline } from '../../api/platform';
import { MetricCard } from '../../components/MetricCard';
import { TrendAreaChart } from '../../components/charts/TrendAreaChart';
const ranges = ['today', 'last7', 'last30', 'month_to_date'];
export function PlatformAnalyticsPage() {
    const [range, setRange] = useState('last7');
    const timelineQuery = useQuery({
        queryKey: ['platform-usage-timeline', range],
        queryFn: () => fetchUsageTimeline(range)
    });
    const callMetricsQuery = useQuery({
        queryKey: ['platform-call-metrics', range],
        queryFn: () => fetchCallCenterMetrics(range)
    });
    const chartData = timelineQuery.data?.map((row) => ({
        label: row.date,
        value: row.totalCalls
    })) ?? [];
    const callMetrics = callMetricsQuery.data;
    return (_jsxs("div", { className: "space-y-10 text-white", children: [_jsxs("header", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm uppercase tracking-[0.3rem] text-white/50", children: "Operational Analytics" }), _jsx("h1", { className: "text-4xl font-bold", children: "Voice AI Call Center Pulse" })] }), _jsx("div", { className: "flex gap-2 bg-white/10 rounded-full p-1 border border-white/10", children: ranges.map((option) => (_jsx("button", { type: "button", onClick: () => setRange(option), className: `px-4 py-2 rounded-full text-sm font-medium transition-all ${range === option
                                ? 'bg-white text-slate-900 shadow-lg'
                                : 'text-white/60 hover:text-white'}`, children: option.replace(/_/g, ' ') }, option))) })] }), _jsxs("section", { className: "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6", children: [_jsx(MetricCard, { label: "Total Calls", value: callMetrics ? callMetrics.totalCalls.toLocaleString() : '—', icon: _jsx(Headphones, { className: "h-5 w-5" }), accent: "sky" }), _jsx(MetricCard, { label: "Average Handle Time", value: callMetrics ? `${callMetrics.averageHandleTime} sec` : '—', icon: _jsx(Timer, { className: "h-5 w-5" }), accent: "indigo" }), _jsx(MetricCard, { label: "First Call Resolution", value: callMetrics ? `${callMetrics.firstCallResolution}%` : '—', icon: _jsx(GaugeCircle, { className: "h-5 w-5" }), accent: "emerald" }), _jsx(MetricCard, { label: "Service Level", value: callMetrics ? `${callMetrics.serviceLevel}%` : '—', icon: _jsx(Users, { className: "h-5 w-5" }), accent: "amber", delta: callMetrics ? `Abandonment ${callMetrics.callAbandonmentRate}%` : undefined })] }), _jsxs("section", { className: "space-y-4", children: [_jsx("h2", { className: "text-lg font-semibold text-white/70", children: "Call Volume Velocity" }), _jsx(TrendAreaChart, { data: chartData, color: "#38bdf8" })] }), _jsxs("section", { className: "grid grid-cols-1 xl:grid-cols-2 gap-6", children: [_jsxs("div", { className: "glass-panel border border-white/10 p-6 space-y-4", children: [_jsx("h3", { className: "text-white/70 font-semibold", children: "Quality Benchmarks" }), _jsxs("ul", { className: "space-y-3 text-sm text-white/70", children: [_jsxs("li", { className: "flex justify-between", children: [_jsx("span", { children: "Call abandonment" }), _jsx("span", { children: callMetrics ? `${callMetrics.callAbandonmentRate}%` : '—' })] }), _jsxs("li", { className: "flex justify-between", children: [_jsx("span", { children: "Repeat call rate" }), _jsx("span", { children: callMetrics ? `${callMetrics.repeatCallRate}%` : '—' })] }), _jsxs("li", { className: "flex justify-between", children: [_jsx("span", { children: "Average wait" }), _jsx("span", { children: "0 sec (AI instant answer)" })] })] })] }), _jsxs("div", { className: "glass-panel border border-white/10 p-6 space-y-4", children: [_jsx("h3", { className: "text-white/70 font-semibold", children: "Insights" }), _jsx("p", { className: "text-white/70 text-sm leading-relaxed", children: "Monitor how voice AI performance maps to orders across the platform. Pair call volume spikes with restaurant staffing and promotional campaigns. Use the service level to benchmark customer experience and trigger proactive outreach when trends slip." })] })] })] }));
}
