import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Leaf, RefreshCw, Clock, CheckCircle, AlertCircle } from 'lucide-react';
import { fetchRestaurantMenu } from '../../api/restaurants';
import { triggerMenuSync, getRestaurantPosConfig, getPosSyncLogs } from '../../api/pos';
import { DataTable } from '../../components/DataTable';
import { useAuthStore } from '../../hooks/useAuthStore';
export function RestaurantMenuPage() {
    const { user } = useAuthStore();
    const queryClient = useQueryClient();
    const [showSyncLogs, setShowSyncLogs] = useState(false);
    const { data: menuItems } = useQuery({
        enabled: Boolean(user?.restaurantId),
        queryKey: ['restaurant-menu', user?.restaurantId],
        queryFn: () => fetchRestaurantMenu(user.restaurantId)
    });
    const { data: posConfig } = useQuery({
        enabled: Boolean(user?.restaurantId),
        queryKey: ['pos-config', user?.restaurantId],
        queryFn: () => getRestaurantPosConfig(user.restaurantId)
    });
    const { data: syncLogs } = useQuery({
        enabled: Boolean(user?.restaurantId) && showSyncLogs,
        queryKey: ['pos-sync-logs', user?.restaurantId],
        queryFn: () => getPosSyncLogs(user.restaurantId)
    });
    const syncMutation = useMutation({
        mutationFn: () => triggerMenuSync(user.restaurantId),
        onSuccess: (result) => {
            alert(`✅ Synced ${result.synced} items from ${result.provider}`);
            queryClient.invalidateQueries({ queryKey: ['restaurant-menu', user?.restaurantId] });
            queryClient.invalidateQueries({ queryKey: ['pos-config', user?.restaurantId] });
            queryClient.invalidateQueries({ queryKey: ['pos-sync-logs', user?.restaurantId] });
        },
        onError: (error) => {
            alert(`❌ Sync failed: ${error.response?.data?.message || error.message}`);
        }
    });
    return (_jsxs("div", { className: "space-y-8 text-white", children: [_jsxs("header", { className: "flex flex-col md:flex-row md:items-center md:justify-between gap-4", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm uppercase tracking-[0.3rem] text-white/50", children: "Menu Management" }), _jsx("h1", { className: "text-4xl font-bold", children: "Voice-Ready Menu" }), posConfig && (_jsxs("div", { className: "flex items-center gap-3 mt-3", children: [_jsxs("span", { className: "text-sm text-white/60", children: ["POS: ", _jsx("span", { className: "text-white font-medium", children: posConfig.posType.toUpperCase() })] }), posConfig.lastSyncAt && (_jsxs("div", { className: "flex items-center gap-2 text-sm text-white/60", children: [_jsx(Clock, { className: "h-4 w-4" }), "Last synced: ", new Date(posConfig.lastSyncAt).toLocaleString()] }))] }))] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsxs("button", { type: "button", onClick: () => setShowSyncLogs(!showSyncLogs), className: "flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 border border-white/10 text-sm text-white/70 hover:text-white hover:bg-white/20 transition-all", children: [showSyncLogs ? 'Hide' : 'View', " Sync Logs"] }), _jsxs("button", { type: "button", onClick: () => syncMutation.mutate(), disabled: syncMutation.isPending, className: "flex items-center gap-2 px-4 py-2 rounded-full bg-white text-slate-900 hover:bg-white/90 transition-all font-medium disabled:opacity-50", children: [_jsx(RefreshCw, { className: `h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}` }), syncMutation.isPending ? 'Syncing...' : 'Sync from POS'] })] })] }), showSyncLogs && syncLogs && (_jsxs("section", { className: "glass-panel p-6 space-y-4", children: [_jsx("h3", { className: "text-lg font-semibold text-white/90", children: "Recent Sync History" }), _jsx("div", { className: "space-y-2", children: syncLogs.map((log) => (_jsxs("div", { className: "flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/10", children: [_jsxs("div", { className: "flex items-center gap-3", children: [log.status === 'success' ? (_jsx(CheckCircle, { className: "h-5 w-5 text-emerald-400" })) : (_jsx(AlertCircle, { className: "h-5 w-5 text-rose-400" })), _jsxs("div", { children: [_jsx("p", { className: "text-sm text-white font-medium", children: log.status === 'success'
                                                        ? `Synced ${log.itemsSynced} items`
                                                        : 'Sync failed' }), log.errorMessage && (_jsx("p", { className: "text-xs text-rose-300", children: log.errorMessage }))] })] }), _jsx("span", { className: "text-xs text-white/50", children: new Date(log.syncedAt).toLocaleString() })] }, log.id))) })] })), _jsx(DataTable, { data: menuItems ?? [], columns: [
                    {
                        header: 'Item',
                        accessor: (row) => (_jsxs("div", { children: [_jsx("p", { className: "font-semibold text-white", children: row.name }), _jsx("p", { className: "text-xs text-white/50", children: row.description })] }))
                    },
                    {
                        header: 'Category',
                        accessor: (row) => row.category
                    },
                    {
                        header: 'Price',
                        accessor: (row) => `$${Number(row.price).toFixed(2)}`
                    },
                    {
                        header: 'Status',
                        accessor: (row) => (_jsxs("span", { className: `inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs ${row.is_available ? 'bg-emerald-500/10 text-emerald-200' : 'bg-rose-500/10 text-rose-200'}`, children: [_jsx(Leaf, { className: "h-3 w-3" }), " ", row.is_available ? 'Available' : 'Unavailable'] }))
                    }
                ], emptyState: "No menu items yet." })] }));
}
