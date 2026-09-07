import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Key, Copy, Trash2, Plus, Clock } from 'lucide-react';

import { generateToken, listTokens, revokeToken } from '../../api/tokens';
import { fetchRestaurantSummaries } from '../../api/platform';
import { DataTable } from '../../components/DataTable';
import { MetricCard } from '../../components/MetricCard';

export function PlatformTokensPage() {
  const [selectedRestaurantId, setSelectedRestaurantId] = useState<string>('');
  const [newToken, setNewToken] = useState<string | null>(null);
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
    mutationFn: (restaurantId: string) => generateToken(restaurantId),
    onSuccess: (data) => {
      setNewToken(data.token);
      setShowTokenModal(true);
      queryClient.invalidateQueries({ queryKey: ['api-tokens', selectedRestaurantId] });
    }
  });

  const revokeMutation = useMutation({
    mutationFn: ({ restaurantId, tokenId }: { restaurantId: string; tokenId: string }) =>
      revokeToken(restaurantId, tokenId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-tokens', selectedRestaurantId] });
    }
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('Token copied to clipboard!');
  };

  return (
    <div className="space-y-8 text-white">
      <header>
        <p className="text-sm uppercase tracking-[0.3rem] text-white/50">API Management</p>
        <h1 className="text-4xl font-bold">Access Tokens</h1>
        <p className="text-white/60 mt-2">
          Generate and manage API tokens for restaurant integrations
        </p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <MetricCard
          label="Total Restaurants"
          value={restaurantsQuery.data?.length.toString() ?? '0'}
          icon={<Key className="h-5 w-5" />}
          accent="indigo"
        />
        <MetricCard
          label="Active Tokens"
          value={tokensQuery.data?.filter((t) => !t.revokedAt).length.toString() ?? '0'}
          icon={<Key className="h-5 w-5" />}
          accent="emerald"
        />
        <MetricCard
          label="Revoked Tokens"
          value={tokensQuery.data?.filter((t) => t.revokedAt).length.toString() ?? '0'}
          icon={<Key className="h-5 w-5" />}
          accent="rose"
        />
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <label className="text-white/70 text-sm">Select Restaurant:</label>
            <select
              value={selectedRestaurantId}
              onChange={(e) => setSelectedRestaurantId(e.target.value)}
              className="bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-white/30"
            >
              <option value="">Choose restaurant...</option>
              {restaurantsQuery.data?.map((restaurant) => (
                <option key={restaurant.restaurantId} value={restaurant.restaurantId}>
                  {restaurant.restaurantName}
                </option>
              ))}
            </select>
          </div>

          {selectedRestaurantId && (
            <button
              type="button"
              onClick={() => generateMutation.mutate(selectedRestaurantId)}
              disabled={generateMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-white text-slate-900 hover:bg-white/90 transition-all font-medium"
            >
              <Plus className="h-4 w-4" />
              Generate Token
            </button>
          )}
        </div>

        {selectedRestaurantId && tokensQuery.data && (
          <DataTable
            data={tokensQuery.data}
            columns={[
              {
                header: 'Token',
                accessor: (row) => (
                  <div className="font-mono text-sm">
                    {row.tokenPrefix}
                    ***************
                  </div>
                )
              },
              {
                header: 'Status',
                accessor: (row) => (
                  <span
                    className={`inline-flex px-3 py-1 rounded-full text-xs ${
                      row.revokedAt
                        ? 'bg-rose-500/10 text-rose-200'
                        : 'bg-emerald-500/10 text-emerald-200'
                    }`}
                  >
                    {row.revokedAt ? 'Revoked' : 'Active'}
                  </span>
                )
              },
              {
                header: 'Last Used',
                accessor: (row) => (
                  <div className="flex items-center gap-2 text-sm text-white/60">
                    <Clock className="h-4 w-4" />
                    {row.lastUsedAt
                      ? new Date(row.lastUsedAt).toLocaleDateString()
                      : 'Never used'}
                  </div>
                )
              },
              {
                header: 'Created',
                accessor: (row) => new Date(row.createdAt).toLocaleDateString()
              },
              {
                header: 'Actions',
                accessor: (row) => (
                  <div className="flex items-center gap-2">
                    {!row.revokedAt && (
                      <button
                        type="button"
                        onClick={() =>
                          revokeMutation.mutate({
                            restaurantId: row.restaurantId,
                            tokenId: row.id
                          })
                        }
                        disabled={revokeMutation.isPending}
                        className="p-2 rounded-lg bg-rose-500/10 text-rose-200 hover:bg-rose-500/20 transition-all"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                )
              }
            ]}
            emptyState="No tokens generated yet."
          />
        )}
      </section>

      {/* Token Modal */}
      {showTokenModal && newToken && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-white/20 rounded-2xl p-8 max-w-2xl w-full mx-4">
            <h2 className="text-2xl font-bold text-white mb-4">New API Token Generated</h2>
            <p className="text-white/60 mb-6">
              Copy this token now. For security reasons, it won't be shown again.
            </p>

            <div className="bg-black/40 border border-white/10 rounded-lg p-4 mb-6">
              <div className="flex items-center justify-between gap-4">
                <code className="text-sm text-emerald-400 font-mono break-all">{newToken}</code>
                <button
                  type="button"
                  onClick={() => copyToClipboard(newToken)}
                  className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-all flex-shrink-0"
                >
                  <Copy className="h-5 w-5 text-white" />
                </button>
              </div>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 mb-6">
              <p className="text-amber-200 text-sm">
                <strong>Security Notice:</strong> Store this token securely. Anyone with this token
                can access your restaurant's API endpoints.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setShowTokenModal(false);
                setNewToken(null);
              }}
              className="w-full px-4 py-3 rounded-lg bg-white text-slate-900 hover:bg-white/90 transition-all font-medium"
            >
              I've copied the token
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

