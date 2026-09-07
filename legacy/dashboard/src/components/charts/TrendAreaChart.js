import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
export function TrendAreaChart({ data, color = '#6366f1' }) {
    return (_jsx("div", { className: "h-64 glass-panel border border-white/5 p-6", children: _jsx(ResponsiveContainer, { width: "100%", height: "100%", children: _jsxs(AreaChart, { data: data, children: [_jsx("defs", { children: _jsxs("linearGradient", { id: "trendGradient", x1: "0", y1: "0", x2: "0", y2: "1", children: [_jsx("stop", { offset: "5%", stopColor: color, stopOpacity: 0.8 }), _jsx("stop", { offset: "95%", stopColor: color, stopOpacity: 0.1 })] }) }), _jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: "rgba(255,255,255,0.05)" }), _jsx(XAxis, { dataKey: "label", stroke: "rgba(255,255,255,0.5)" }), _jsx(YAxis, { stroke: "rgba(255,255,255,0.5)" }), _jsx(Tooltip, { contentStyle: {
                            backgroundColor: 'rgba(15,23,42,0.9)',
                            borderRadius: '12px',
                            border: '1px solid rgba(255,255,255,0.1)',
                            color: '#fff'
                        } }), _jsx(Area, { type: "monotone", dataKey: "value", stroke: color, strokeWidth: 3, fillOpacity: 1, fill: "url(#trendGradient)" })] }) }) }));
}
