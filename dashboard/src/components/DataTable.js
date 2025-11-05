import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function DataTable({ data, columns, emptyState }) {
    if (!data.length) {
        return (_jsx("div", { className: "glass-panel p-8 border border-white/5 text-center text-white/60", children: emptyState ?? 'No records yet.' }));
    }
    return (_jsx("div", { className: "glass-panel border border-white/10 overflow-hidden", children: _jsxs("table", { className: "min-w-full divide-y divide-white/10", children: [_jsx("thead", { className: "bg-white/5", children: _jsx("tr", { children: columns.map((column) => (_jsx("th", { className: `px-6 py-4 text-left text-xs font-semibold uppercase tracking-widest text-white/60 ${column.className ?? ''}`, children: column.header }, column.header))) }) }), _jsx("tbody", { className: "divide-y divide-white/5", children: data.map((row, index) => (_jsx("tr", { className: "hover:bg-white/5 transition-colors", children: columns.map((column) => (_jsx("td", { className: `px-6 py-4 text-sm text-white/80 ${column.className ?? ''}`, children: column.accessor(row) }, column.header))) }, index))) })] }) }));
}
