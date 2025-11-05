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
    queryFn: () => fetchRestaurantMenu(user!.restaurantId!)
  });

  const { data: posConfig } = useQuery({
    enabled: Boolean(user?.restaurantId),
    queryKey: ['pos-config', user?.restaurantId],
    queryFn: () => getRestaurantPosConfig(user!.restaurantId!)
  });

  const { data: syncLogs } = useQuery({
    enabled: Boolean(user?.restaurantId) && showSyncLogs,
    queryKey: ['pos-sync-logs', user?.restaurantId],
    queryFn: () => getPosSyncLogs(user!.restaurantId!)
  });

  const syncMutation = useMutation({
    mutationFn: () => triggerMenuSync(user!.restaurantId!),
    onSuccess: (result) => {
      alert(`✅ Synced ${result.synced} items from ${result.provider}`);
      queryClient.invalidateQueries({ queryKey: ['restaurant-menu', user?.restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['pos-config', user?.restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['pos-sync-logs', user?.restaurantId] });
    },
    onError: (error: any) => {
      alert(`❌ Sync failed: ${error.response?.data?.message || error.message}`);
    }
  });

  return (
    <div className="space-y-8 text-white">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.3rem] text-white/50">Menu Management</p>
          <h1 className="text-4xl font-bold">Voice-Ready Menu</h1>
          {posConfig && (
            <div className="flex items-center gap-3 mt-3">
              <span className="text-sm text-white/60">
                POS: <span className="text-white font-medium">{posConfig.posType.toUpperCase()}</span>
              </span>
              {posConfig.lastSyncAt && (
                <div className="flex items-center gap-2 text-sm text-white/60">
                  <Clock className="h-4 w-4" />
                  Last synced: {new Date(posConfig.lastSyncAt).toLocaleString()}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowSyncLogs(!showSyncLogs)}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 border border-white/10 text-sm text-white/70 hover:text-white hover:bg-white/20 transition-all"
          >
            {showSyncLogs ? 'Hide' : 'View'} Sync Logs
          </button>
          <button
            type="button"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-white text-slate-900 hover:bg-white/90 transition-all font-medium disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
            {syncMutation.isPending ? 'Syncing...' : 'Sync from POS'}
          </button>
        </div>
      </header>

      {showSyncLogs && syncLogs && (
        <section className="glass-panel p-6 space-y-4">
          <h3 className="text-lg font-semibold text-white/90">Recent Sync History</h3>
          <div className="space-y-2">
            {syncLogs.map((log) => (
              <div
                key={log.id}
                className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/10"
              >
                <div className="flex items-center gap-3">
                  {log.status === 'success' ? (
                    <CheckCircle className="h-5 w-5 text-emerald-400" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-rose-400" />
                  )}
                  <div>
                    <p className="text-sm text-white font-medium">
                      {log.status === 'success'
                        ? `Synced ${log.itemsSynced} items`
                        : 'Sync failed'}
                    </p>
                    {log.errorMessage && (
                      <p className="text-xs text-rose-300">{log.errorMessage}</p>
                    )}
                  </div>
                </div>
                <span className="text-xs text-white/50">
                  {new Date(log.syncedAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <DataTable
        data={menuItems ?? []}
        columns={[
          {
            header: 'Item',
            accessor: (row: any) => (
              <div>
                <p className="font-semibold text-white">{row.name}</p>
                <p className="text-xs text-white/50">{row.description}</p>
              </div>
            )
          },
          {
            header: 'Category',
            accessor: (row: any) => row.category
          },
          {
            header: 'Price',
            accessor: (row: any) => `$${Number(row.price).toFixed(2)}`
          },
          {
            header: 'Status',
            accessor: (row: any) => (
              <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs ${
                row.is_available ? 'bg-emerald-500/10 text-emerald-200' : 'bg-rose-500/10 text-rose-200'
              }`}>
                <Leaf className="h-3 w-3" /> {row.is_available ? 'Available' : 'Unavailable'}
              </span>
            )
          }
        ]}
        emptyState="No menu items yet."
      />
    </div>
  );
}
