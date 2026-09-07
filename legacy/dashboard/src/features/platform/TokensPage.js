import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Key, Copy, Trash2, Plus, Clock } from 'lucide-react';
import { generateToken, listTokens, revokeToken } from '../../api/tokens';
import { fetchRestaurantSummaries } from '../../api/platform';
import { DataTable } from '../../components/DataTable';
import { MetricCard } from '../../components/MetricCard';
export function PlatformTokensPage() {
    const [selectedRestaurantId, setSelectedRestaurantId] = useState('');
    const [newToken, setNewToken] = useState(null);
    const [showTokenModal, setShowTokenModal] = useState(false);
    const queryClient = useQueryClient();
    const restaurantsQuery = useQuery({
        queryKey: ['platform-restaurants', 'today'],
        queryFn: () => fetchRestaurantSummaries('today')
    });
    const tokensQuery = useQuery({
        queryKey: ['api-tokens', selectedRestaurantId],
        queryFn: () => listTokens(selectedRestaurantId),
        enabled: Boolean(selectedRestaurantId)
    });
    const generateMutation = useMutation({
        mutationFn: (restaurantId) => generateToken(restaurantId),
        onSuccess: (data) => {
            setNewToken(data.token);
            setShowTokenModal(true);
            queryClient.invalidateQueries({ queryKey: ['api-tokens', selectedRestaurantId] });
        }
    });
    const revokeMutation = useMutation({
        mutationFn: ({ restaurantId, tokenId }) => revokeToken(restaurantId, tokenId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['api-tokens', selectedRestaurantId] });
        }
    });
    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        alert('Token copied to clipboard!');
    };
    return (_jsxs("div", { className: "space-y-8 text-white", children: [_jsxs("header", { children: [_jsx("p", { className: "text-sm uppercase tracking-[0.3rem] text-white/50", children: "API Management" }), _jsx("h1", { className: "text-4xl font-bold", children: "Access Tokens" }), _jsx("p", { className: "text-white/60 mt-2", children: "Generate and manage API tokens for restaurant integrations" })] }), _jsxs("section", { className: "grid grid-cols-1 md:grid-cols-3 gap-6", children: [_jsx(MetricCard, { label: "Total Restaurants", value: restaurantsQuery.data?.length.toString() ?? '0', icon: _jsx(Key, { className: "h-5 w-5" }), accent: "indigo" }), _jsx(MetricCard, { label: "Active Tokens", value: tokensQuery.data?.filter((t) => !t.revokedAt).length.toString() ?? '0', icon: _jsx(Key, { className: "h-5 w-5" }), accent: "emerald" }), _jsx(MetricCard, { label: "Revoked Tokens", value: tokensQuery.data?.filter((t) => t.revokedAt).length.toString() ?? '0', icon: _jsx(Key, { className: "h-5 w-5" }), accent: "rose" })] }), _jsxs("section", { className: "space-y-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-4", children: [_jsx("label", { className: "text-white/70 text-sm", children: "Select Restaurant:" }), _jsxs("select", { value: selectedRestaurantId, onChange: (e) => setSelectedRestaurantId(e.target.value), className: "bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-white/30", children: [_jsx("option", { value: "", children: "Choose restaurant..." }), restaurantsQuery.data?.map((restaurant) => (_jsx("option", { value: restaurant.restaurantId, children: restaurant.restaurantName }, restaurant.restaurantId)))] })] }), selectedRestaurantId && (_jsxs("button", { type: "button", onClick: () => generateMutation.mutate(selectedRestaurantId), disabled: generateMutation.isPending, className: "flex items-center gap-2 px-4 py-2 rounded-full bg-white text-slate-900 hover:bg-white/90 transition-all font-medium", children: [_jsx(Plus, { className: "h-4 w-4" }), "Generate Token"] }))] }), selectedRestaurantId && tokensQuery.data && (_jsx(DataTable, { data: tokensQuery.data, columns: [
                            {
                                header: 'Token',
                                accessor: (row) => (_jsxs("div", { className: "font-mono text-sm", children: [row.tokenPrefix, "***************"] }))
                            },
                            {
                                header: 'Status',
                                accessor: (row) => (_jsx("span", { className: `inline-flex px-3 py-1 rounded-full text-xs ${row.revokedAt
                                        ? 'bg-rose-500/10 text-rose-200'
                                        : 'bg-emerald-500/10 text-emerald-200'}`, children: row.revokedAt ? 'Revoked' : 'Active' }))
                            },
                            {
                                header: 'Last Used',
                                accessor: (row) => (_jsxs("div", { className: "flex items-center gap-2 text-sm text-white/60", children: [_jsx(Clock, { className: "h-4 w-4" }), row.lastUsedAt
                                            ? new Date(row.lastUsedAt).toLocaleDateString()
                                            : 'Never used'] }))
                            },
                            {
                                header: 'Created',
                                accessor: (row) => new Date(row.createdAt).toLocaleDateString()
                            },
                            {
                                header: 'Actions',
                                accessor: (row) => (_jsx("div", { className: "flex items-center gap-2", children: !row.revokedAt && (_jsx("button", { type: "button", onClick: () => revokeMutation.mutate({
                                            restaurantId: row.restaurantId,
                                            tokenId: row.id
                                        }), disabled: revokeMutation.isPending, className: "p-2 rounded-lg bg-rose-500/10 text-rose-200 hover:bg-rose-500/20 transition-all", children: _jsx(Trash2, { className: "h-4 w-4" }) })) }))
                            }
                        ], emptyState: "No tokens generated yet." }))] }), showTokenModal && newToken && (_jsx("div", { className: "fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50", children: _jsxs("div", { className: "bg-slate-900 border border-white/20 rounded-2xl p-8 max-w-2xl w-full mx-4", children: [_jsx("h2", { className: "text-2xl font-bold text-white mb-4", children: "New API Token Generated" }), _jsx("p", { className: "text-white/60 mb-6", children: "Copy this token now. For security reasons, it won't be shown again." }), _jsx("div", { className: "bg-black/40 border border-white/10 rounded-lg p-4 mb-6", children: _jsxs("div", { className: "flex items-center justify-between gap-4", children: [_jsx("code", { className: "text-sm text-emerald-400 font-mono break-all", children: newToken }), _jsx("button", { type: "button", onClick: () => copyToClipboard(newToken), className: "p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-all flex-shrink-0", children: _jsx(Copy, { className: "h-5 w-5 text-white" }) })] }) }), _jsx("div", { className: "bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 mb-6", children: _jsxs("p", { className: "text-amber-200 text-sm", children: [_jsx("strong", { children: "Security Notice:" }), " Store this token securely. Anyone with this token can access your restaurant's API endpoints."] }) }), _jsx("button", { type: "button", onClick: () => {
                                setShowTokenModal(false);
                                setNewToken(null);
                            }, className: "w-full px-4 py-3 rounded-lg bg-white text-slate-900 hover:bg-white/90 transition-all font-medium", children: "I've copied the token" })] }) }))] }));
}
