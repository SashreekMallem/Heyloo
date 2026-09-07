import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Leaf, RefreshCw, Clock, CheckCircle, AlertCircle } from 'lucide-react';

import {
  fetchRestaurantMenu,
  fetchRestaurantDetails,
  createManualMenuItem,
  updateManualMenuItem,
  deleteManualMenuItem
} from '../../api/restaurants';
import { triggerMenuSync, getRestaurantPosConfig, getPosSyncLogs } from '../../api/pos';
import { DataTable } from '../../components/DataTable';
import { useAuthStore } from '../../hooks/useAuthStore';

export function RestaurantMenuPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [showSyncLogs, setShowSyncLogs] = useState(false);
  const [showMenuForm, setShowMenuForm] = useState(false);
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [menuForm, setMenuForm] = useState({
    name: '',
    price: '',
    category: '',
    description: '',
    isAvailable: true
  });

  const { data: restaurantDetails } = useQuery({
    enabled: Boolean(user?.restaurantId),
    queryKey: ['restaurant-details', user?.restaurantId],
    queryFn: () => fetchRestaurantDetails(user!.restaurantId!)
  });

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

  const manualMode = Boolean(restaurantDetails?.manual_mode);

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

  const upsertMenuMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: menuForm.name,
        price: Number(menuForm.price),
        category: menuForm.category || null,
        description: menuForm.description || null,
        isAvailable: menuForm.isAvailable
      };
      if (editingItem) {
        return updateManualMenuItem(user!.restaurantId!, editingItem.id, payload);
      }
      return createManualMenuItem(user!.restaurantId!, payload);
    },
    onSuccess: () => {
      setShowMenuForm(false);
      setEditingItem(null);
      setMenuForm({ name: '', price: '', category: '', description: '', isAvailable: true });
      queryClient.invalidateQueries({ queryKey: ['restaurant-menu', user?.restaurantId] });
    },
    onError: (error: any) => {
      alert(`Failed to save menu item: ${error.response?.data?.message || error.message}`);
    }
  });

  const deleteMenuMutation = useMutation({
    mutationFn: (itemId: string) => deleteManualMenuItem(user!.restaurantId!, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['restaurant-menu', user?.restaurantId] });
    },
    onError: (error: any) => {
      alert(`Failed to delete menu item: ${error.response?.data?.message || error.message}`);
    }
  });

  const openMenuForm = (item?: any) => {
    if (item) {
      setEditingItem(item);
      setMenuForm({
        name: item.name,
        price: item.price,
        category: item.category || '',
        description: item.description || '',
        isAvailable: item.is_available
      });
    } else {
      setEditingItem(null);
      setMenuForm({ name: '', price: '', category: '', description: '', isAvailable: true });
    }
    setShowMenuForm(true);
  };

  const columns = [
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
  ] as any[];

  if (manualMode) {
    columns.push({
      header: 'Actions',
      accessor: (row: any) => (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openMenuForm(row)}
            className="px-3 py-1 rounded-full bg-white/10 text-xs hover:bg-white/20"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => deleteMenuMutation.mutate(row.id)}
            className="px-3 py-1 rounded-full bg-rose-500/20 text-xs text-rose-200 hover:bg-rose-500/30"
          >
            Delete
          </button>
        </div>
      )
    });
  }

  return (
    <div className="space-y-8 text-white">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.3rem] text-white/50">Menu Management</p>
          <h1 className="text-4xl font-bold">Voice-Ready Menu</h1>
          {manualMode ? (
            <div className="mt-3 text-sm text-amber-300 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Manual mode enabled – manage menu items locally.
            </div>
          ) : posConfig ? (
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
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {manualMode ? (
            <button
              type="button"
              onClick={() => openMenuForm()}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-white text-slate-900 hover:bg-white/90 transition-all font-medium"
            >
              Add Menu Item
            </button>
          ) : (
            <>
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
            </>
          )}
        </div>
      </header>

      {manualMode && showMenuForm && (
        <section className="glass-panel p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white/90">
              {editingItem ? 'Edit Menu Item' : 'Add Menu Item'}
            </h3>
            <button
              type="button"
              onClick={() => {
                setShowMenuForm(false);
                setEditingItem(null);
              }}
              className="text-white/60 hover:text-white"
            >
              Cancel
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-2 text-sm text-white/70">
              Name
              <input
                className="w-full rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-white"
                value={menuForm.name}
                onChange={(event) => setMenuForm((prev) => ({ ...prev, name: event.target.value }))}
              />
            </label>
            <label className="space-y-2 text-sm text-white/70">
              Price
              <input
                type="number"
                step="0.01"
                className="w-full rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-white"
                value={menuForm.price}
                onChange={(event) => setMenuForm((prev) => ({ ...prev, price: event.target.value }))}
              />
            </label>
            <label className="space-y-2 text-sm text-white/70">
              Category
              <input
                className="w-full rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-white"
                value={menuForm.category}
                onChange={(event) => setMenuForm((prev) => ({ ...prev, category: event.target.value }))}
              />
            </label>
            <label className="space-y-2 text-sm text-white/70">
              Description
              <input
                className="w-full rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-white"
                value={menuForm.description}
                onChange={(event) => setMenuForm((prev) => ({ ...prev, description: event.target.value }))}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-white/80">
              <input
                type="checkbox"
                checked={menuForm.isAvailable}
                onChange={(event) => setMenuForm((prev) => ({ ...prev, isAvailable: event.target.checked }))}
              />
              Available
            </label>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => upsertMenuMutation.mutate()}
              disabled={upsertMenuMutation.isPending}
              className="px-4 py-2 rounded-full bg-white text-slate-900 font-medium"
            >
              {upsertMenuMutation.isPending ? 'Saving…' : 'Save Item'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowMenuForm(false);
                setEditingItem(null);
              }}
              className="px-4 py-2 rounded-full bg-white/10 border border-white/10"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {!manualMode && showSyncLogs && syncLogs && (
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

      <DataTable data={menuItems ?? []} columns={columns.filter(Boolean)} emptyState="No menu items yet." />
    </div>
  );
}
