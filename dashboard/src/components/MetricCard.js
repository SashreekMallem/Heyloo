import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const accentMap = {
    indigo: 'from-indigo-500/20 to-purple-500/10 border-indigo-500/30 text-indigo-100',
    emerald: 'from-emerald-500/20 to-teal-500/10 border-emerald-500/30 text-emerald-100',
    sky: 'from-sky-500/20 to-cyan-500/10 border-sky-500/30 text-sky-100',
    rose: 'from-rose-500/20 to-pink-500/10 border-rose-500/30 text-rose-100',
    amber: 'from-amber-500/20 to-orange-500/10 border-amber-500/30 text-amber-100'
};
export function MetricCard({ label, value, delta, icon, accent = 'indigo' }) {
    return (_jsxs("div", { className: `glass-panel p-6 border ${accentMap[accent]} backdrop-blur-xl shadow-2xl space-y-4`, children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("p", { className: "text-sm uppercase tracking-widest text-white/70", children: label }), icon ? _jsx("div", { className: "h-10 w-10 rounded-full bg-white/10 flex items-center justify-center", children: icon }) : null] }), _jsx("div", { className: "text-3xl font-semibold text-white", children: value }), delta ? _jsx("div", { className: "text-xs text-white/70", children: delta }) : null] }));
}
