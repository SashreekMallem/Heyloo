import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users, Phone, Mail, DollarSign, Package, MapPin } from 'lucide-react';
import { fetchRestaurantCustomers, fetchCustomerAddresses } from '../../api/customers';
import { DataTable } from '../../components/DataTable';
import { useAuthStore } from '../../hooks/useAuthStore';
export function RestaurantCustomersPage() {
    const { user } = useAuthStore();
    const [selectedCustomerId, setSelectedCustomerId] = useState(null);
    const { data: customers, isLoading } = useQuery({
        enabled: Boolean(user?.restaurantId),
        queryKey: ['restaurant-customers', user?.restaurantId],
        queryFn: () => fetchRestaurantCustomers(user.restaurantId)
    });
    const { data: addresses } = useQuery({
        enabled: Boolean(selectedCustomerId && user?.restaurantId),
        queryKey: ['customer-addresses', user?.restaurantId, selectedCustomerId],
        queryFn: () => fetchCustomerAddresses(user.restaurantId, selectedCustomerId)
    });
    const customerSegments = customers
        ? {
            vip: customers.filter((c) => c.totalOrders >= 10).length,
            loyal: customers.filter((c) => c.totalOrders >= 5 && c.totalOrders < 10).length,
            returning: customers.filter((c) => c.totalOrders >= 2 && c.totalOrders < 5).length,
            new: customers.filter((c) => c.totalOrders === 1).length
        }
        : { vip: 0, loyal: 0, returning: 0, new: 0 };
    return (_jsxs("div", { className: "space-y-8 text-white", children: [_jsxs("header", { children: [_jsx("p", { className: "text-sm uppercase tracking-[0.3rem] text-white/50", children: "Customer Insights" }), _jsx("h1", { className: "text-4xl font-bold", children: "Customer Management" })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-4 gap-6", children: [_jsxs("div", { className: "glass-panel p-6", children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsx("span", { className: "text-sm uppercase tracking-wider text-white/60", children: "VIP Customers" }), _jsx(Users, { className: "h-5 w-5 text-purple-400" })] }), _jsx("p", { className: "text-3xl font-bold", children: customerSegments.vip }), _jsx("p", { className: "text-xs text-white/40 mt-1", children: "10+ orders" })] }), _jsxs("div", { className: "glass-panel p-6", children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsx("span", { className: "text-sm uppercase tracking-wider text-white/60", children: "Loyal" }), _jsx(Users, { className: "h-5 w-5 text-blue-400" })] }), _jsx("p", { className: "text-3xl font-bold", children: customerSegments.loyal }), _jsx("p", { className: "text-xs text-white/40 mt-1", children: "5-9 orders" })] }), _jsxs("div", { className: "glass-panel p-6", children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsx("span", { className: "text-sm uppercase tracking-wider text-white/60", children: "Returning" }), _jsx(Users, { className: "h-5 w-5 text-emerald-400" })] }), _jsx("p", { className: "text-3xl font-bold", children: customerSegments.returning }), _jsx("p", { className: "text-xs text-white/40 mt-1", children: "2-4 orders" })] }), _jsxs("div", { className: "glass-panel p-6", children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsx("span", { className: "text-sm uppercase tracking-wider text-white/60", children: "New" }), _jsx(Users, { className: "h-5 w-5 text-amber-400" })] }), _jsx("p", { className: "text-3xl font-bold", children: customerSegments.new }), _jsx("p", { className: "text-xs text-white/40 mt-1", children: "1 order" })] })] }), isLoading ? (_jsx("div", { className: "glass-panel p-10 text-center text-white/60", children: "Loading customers\u2026" })) : (_jsxs("section", { className: "space-y-4", children: [_jsx("h2", { className: "text-xl font-semibold text-white/90", children: "All Customers" }), _jsx(DataTable, { data: customers ?? [], columns: [
                            {
                                header: 'Customer',
                                accessor: (row) => (_jsxs("div", { children: [_jsx("p", { className: "font-semibold text-white", children: row.first_name || row.last_name
                                                ? `${row.first_name || ''} ${row.last_name || ''}`.trim()
                                                : 'Unknown' }), _jsxs("div", { className: "flex items-center gap-2 mt-1", children: [_jsx(Phone, { className: "h-3 w-3 text-white/40" }), _jsx("p", { className: "text-xs text-white/60", children: row.phone_number })] }), row.email && (_jsxs("div", { className: "flex items-center gap-2 mt-1", children: [_jsx(Mail, { className: "h-3 w-3 text-white/40" }), _jsx("p", { className: "text-xs text-white/60", children: row.email })] }))] }))
                            },
                            {
                                header: 'Orders',
                                accessor: (row) => (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Package, { className: "h-4 w-4 text-white/40" }), _jsx("span", { className: "font-semibold", children: row.total_orders })] }))
                            },
                            {
                                header: 'Total Spent',
                                accessor: (row) => (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(DollarSign, { className: "h-4 w-4 text-emerald-400" }), _jsxs("span", { className: "font-semibold text-emerald-200", children: ["$", Number(row.total_spent).toFixed(2)] })] }))
                            },
                            {
                                header: 'Avg Order',
                                accessor: (row) => {
                                    const avg = row.total_orders > 0 ? row.total_spent / row.total_orders : 0;
                                    return _jsxs("span", { className: "text-white/70", children: ["$", avg.toFixed(2)] });
                                }
                            },
                            {
                                header: 'Segment',
                                accessor: (row) => {
                                    let segment = 'New';
                                    let color = 'amber';
                                    if (row.total_orders >= 10) {
                                        segment = 'VIP';
                                        color = 'purple';
                                    }
                                    else if (row.total_orders >= 5) {
                                        segment = 'Loyal';
                                        color = 'blue';
                                    }
                                    else if (row.total_orders >= 2) {
                                        segment = 'Returning';
                                        color = 'emerald';
                                    }
                                    return (_jsx("span", { className: `inline-block px-3 py-1 rounded-full text-xs font-medium bg-${color}-500/10 text-${color}-200 border border-${color}-500/20`, children: segment }));
                                }
                            },
                            {
                                header: 'Actions',
                                accessor: (row) => (_jsxs("button", { type: "button", onClick: () => setSelectedCustomerId(selectedCustomerId === row.id ? null : row.id), className: "flex items-center gap-2 px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-sm transition-colors", children: [_jsx(MapPin, { className: "h-4 w-4" }), selectedCustomerId === row.id ? 'Hide' : 'View', " Addresses"] }))
                            }
                        ], emptyState: "No customers yet." })] })), selectedCustomerId && addresses && addresses.length > 0 && (_jsxs("section", { className: "glass-panel p-6 space-y-4", children: [_jsx("h3", { className: "text-lg font-semibold text-white/90", children: "Saved Addresses" }), _jsx("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4", children: addresses.map((addr) => (_jsxs("div", { className: "p-4 bg-white/5 rounded-lg border border-white/10", children: [addr.label && (_jsxs("p", { className: "text-sm font-medium text-white/90 mb-2", children: [addr.label, " ", addr.isDefault && _jsx("span", { className: "text-emerald-400", children: "\u2605" })] })), _jsxs("p", { className: "text-sm text-white/70", children: [addr.street, _jsx("br", {}), addr.city, ", ", addr.state, " ", addr.postalCode] }), addr.deliveryInstructions && (_jsxs("p", { className: "text-xs text-white/50 mt-2 italic", children: ["Note: ", addr.deliveryInstructions] }))] }, addr.id))) })] }))] }));
}
