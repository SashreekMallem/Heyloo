import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, Phone, Mail, DollarSign, Package, MapPin } from 'lucide-react';

import { fetchRestaurantCustomers, fetchCustomerAddresses } from '../../api/customers';
import {
  fetchRestaurantDetails,
  createManualCustomer,
  updateManualCustomer,
  deleteManualCustomer
} from '../../api/restaurants';
import { DataTable } from '../../components/DataTable';
import { useAuthStore } from '../../hooks/useAuthStore';

export function RestaurantCustomersPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<any | null>(null);
  const [customerForm, setCustomerForm] = useState({
    firstName: '',
    lastName: '',
    phoneNumber: '',
    email: '',
    notes: ''
  });

  const { data: restaurantDetails } = useQuery({
    enabled: Boolean(user?.restaurantId),
    queryKey: ['restaurant-details', user?.restaurantId],
    queryFn: () => fetchRestaurantDetails(user!.restaurantId!)
  });

  const { data: customers, isLoading } = useQuery({
    enabled: Boolean(user?.restaurantId),
    queryKey: ['restaurant-customers', user?.restaurantId],
    queryFn: () => fetchRestaurantCustomers(user!.restaurantId!)
  });

  const { data: addresses } = useQuery({
    enabled: Boolean(selectedCustomerId && user?.restaurantId),
    queryKey: ['customer-addresses', user?.restaurantId, selectedCustomerId],
    queryFn: () => fetchCustomerAddresses(user!.restaurantId!, selectedCustomerId!)
  });

  const customerSegments = customers
    ? {
        vip: customers.filter((c) => c.totalOrders >= 10).length,
        loyal: customers.filter((c) => c.totalOrders >= 5 && c.totalOrders < 10).length,
        returning: customers.filter((c) => c.totalOrders >= 2 && c.totalOrders < 5).length,
        new: customers.filter((c) => c.totalOrders === 1).length
      }
    : { vip: 0, loyal: 0, returning: 0, new: 0 };

  const manualMode = Boolean(restaurantDetails?.manual_mode);

  const upsertCustomerMutation = useMutation({
    mutationFn: async () => {
      const payload = { ...customerForm };
      if (editingCustomer) {
        return updateManualCustomer(user!.restaurantId!, editingCustomer.id, payload);
      }
      return createManualCustomer(user!.restaurantId!, payload);
    },
    onSuccess: () => {
      setShowCustomerForm(false);
      setEditingCustomer(null);
      setCustomerForm({ firstName: '', lastName: '', phoneNumber: '', email: '', notes: '' });
      queryClient.invalidateQueries({ queryKey: ['restaurant-customers', user?.restaurantId] });
    },
    onError: (error: any) => {
      alert(`Failed to save customer: ${error.response?.data?.message || error.message}`);
    }
  });

  const deleteCustomerMutation = useMutation({
    mutationFn: (customerId: string) => deleteManualCustomer(user!.restaurantId!, customerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['restaurant-customers', user?.restaurantId] });
    },
    onError: (error: any) => {
      alert(`Failed to delete customer: ${error.response?.data?.message || error.message}`);
    }
  });

  const openCustomerForm = (customer?: any) => {
    if (customer) {
      setEditingCustomer(customer);
      setCustomerForm({
        firstName: customer.first_name || '',
        lastName: customer.last_name || '',
        phoneNumber: customer.phone_number || '',
        email: customer.email || '',
        notes: customer.notes || ''
      });
    } else {
      setEditingCustomer(null);
      setCustomerForm({ firstName: '', lastName: '', phoneNumber: '', email: '', notes: '' });
    }
    setShowCustomerForm(true);
  };

  return (
    <div className="space-y-8 text-white">
      <header>
        <p className="text-sm uppercase tracking-[0.3rem] text-white/50">Customer Insights</p>
        <h1 className="text-4xl font-bold">Customer Management</h1>
      </header>

      {/* Customer Segments */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="glass-panel p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm uppercase tracking-wider text-white/60">VIP Customers</span>
            <Users className="h-5 w-5 text-purple-400" />
          </div>
          <p className="text-3xl font-bold">{customerSegments.vip}</p>
          <p className="text-xs text-white/40 mt-1">10+ orders</p>
        </div>

        <div className="glass-panel p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm uppercase tracking-wider text-white/60">Loyal</span>
            <Users className="h-5 w-5 text-blue-400" />
          </div>
          <p className="text-3xl font-bold">{customerSegments.loyal}</p>
          <p className="text-xs text-white/40 mt-1">5-9 orders</p>
        </div>

        <div className="glass-panel p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm uppercase tracking-wider text-white/60">Returning</span>
            <Users className="h-5 w-5 text-emerald-400" />
          </div>
          <p className="text-3xl font-bold">{customerSegments.returning}</p>
          <p className="text-xs text-white/40 mt-1">2-4 orders</p>
        </div>

        <div className="glass-panel p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm uppercase tracking-wider text-white/60">New</span>
            <Users className="h-5 w-5 text-amber-400" />
          </div>
          <p className="text-3xl font-bold">{customerSegments.new}</p>
          <p className="text-xs text-white/40 mt-1">1 order</p>
        </div>
      </div>

      {manualMode && showCustomerForm && (
        <section className="glass-panel p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white/90">
              {editingCustomer ? 'Edit Customer' : 'Add Customer'}
            </h3>
            <button
              type="button"
              onClick={() => {
                setShowCustomerForm(false);
                setEditingCustomer(null);
              }}
              className="text-white/60 hover:text-white"
            >
              Cancel
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-2 text-sm text-white/70">
              First Name
              <input
                className="w-full rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-white"
                value={customerForm.firstName}
                onChange={(event) => setCustomerForm((prev) => ({ ...prev, firstName: event.target.value }))}
              />
            </label>
            <label className="space-y-2 text-sm text-white/70">
              Last Name
              <input
                className="w-full rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-white"
                value={customerForm.lastName}
                onChange={(event) => setCustomerForm((prev) => ({ ...prev, lastName: event.target.value }))}
              />
            </label>
            <label className="space-y-2 text-sm text-white/70">
              Phone Number
              <input
                className="w-full rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-white"
                value={customerForm.phoneNumber}
                onChange={(event) => setCustomerForm((prev) => ({ ...prev, phoneNumber: event.target.value }))}
              />
            </label>
            <label className="space-y-2 text-sm text-white/70">
              Email
              <input
                className="w-full rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-white"
                value={customerForm.email}
                onChange={(event) => setCustomerForm((prev) => ({ ...prev, email: event.target.value }))}
              />
            </label>
            <label className="space-y-2 text-sm text-white/70 md:col-span-2">
              Notes
              <textarea
                className="w-full rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-white"
                value={customerForm.notes}
                onChange={(event) => setCustomerForm((prev) => ({ ...prev, notes: event.target.value }))}
              />
            </label>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => upsertCustomerMutation.mutate()}
              disabled={upsertCustomerMutation.isPending}
              className="px-4 py-2 rounded-full bg-white text-slate-900 font-medium"
            >
              {upsertCustomerMutation.isPending ? 'Saving…' : 'Save Customer'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCustomerForm(false);
                setEditingCustomer(null);
              }}
              className="px-4 py-2 rounded-full bg-white/10 border border-white/10"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      <div className="flex justify-end">
        {manualMode && (
          <button
            type="button"
            onClick={() => openCustomerForm()}
            className="px-4 py-2 rounded-full bg-white text-slate-900 font-medium"
          >
            Add Customer
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="glass-panel p-10 text-center text-white/60">Loading customers…</div>
      ) : (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-white/90">All Customers</h2>
          <DataTable
            data={customers ?? []}
            columns={[
              {
                header: 'Customer',
                accessor: (row: any) => (
                  <div>
                    <p className="font-semibold text-white">
                      {row.first_name || row.last_name
                        ? `${row.first_name || ''} ${row.last_name || ''}`.trim()
                        : 'Unknown'}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <Phone className="h-3 w-3 text-white/40" />
                      <p className="text-xs text-white/60">{row.phone_number}</p>
                    </div>
                    {row.email && (
                      <div className="flex items-center gap-2 mt-1">
                        <Mail className="h-3 w-3 text-white/40" />
                        <p className="text-xs text-white/60">{row.email}</p>
                      </div>
                    )}
                  </div>
                )
              },
              {
                header: 'Orders',
                accessor: (row: any) => (
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-white/40" />
                    <span className="font-semibold">{row.total_orders}</span>
                  </div>
                )
              },
              {
                header: 'Total Spent',
                accessor: (row: any) => (
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-emerald-400" />
                    <span className="font-semibold text-emerald-200">
                      ${Number(row.total_spent).toFixed(2)}
                    </span>
                  </div>
                )
              },
              {
                header: 'Avg Order',
                accessor: (row: any) => {
                  const avg = row.total_orders > 0 ? row.total_spent / row.total_orders : 0;
                  return <span className="text-white/70">${avg.toFixed(2)}</span>;
                }
              },
              {
                header: 'Segment',
                accessor: (row: any) => {
                  let segment = 'New';
                  let color = 'amber';
                  if (row.total_orders >= 10) {
                    segment = 'VIP';
                    color = 'purple';
                  } else if (row.total_orders >= 5) {
                    segment = 'Loyal';
                    color = 'blue';
                  } else if (row.total_orders >= 2) {
                    segment = 'Returning';
                    color = 'emerald';
                  }

                  return (
                    <span
                      className={`inline-block px-3 py-1 rounded-full text-xs font-medium bg-${color}-500/10 text-${color}-200 border border-${color}-500/20`}
                    >
                      {segment}
                    </span>
                  );
                }
              },
              {
                header: 'Actions',
                accessor: (row: any) => (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedCustomerId(selectedCustomerId === row.id ? null : row.id)
                      }
                      className="flex items-center gap-2 px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-sm transition-colors"
                    >
                      <MapPin className="h-4 w-4" />
                      {selectedCustomerId === row.id ? 'Hide' : 'View'} Addresses
                    </button>
                    {manualMode && (
                      <>
                        <button
                          type="button"
                          onClick={() => openCustomerForm(row)}
                          className="px-3 py-1 rounded-full bg-white/10 text-xs hover:bg-white/20"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteCustomerMutation.mutate(row.id)}
                          className="px-3 py-1 rounded-full bg-rose-500/20 text-xs text-rose-200 hover:bg-rose-500/30"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                )
              }
            ]}
            emptyState="No customers yet."
          />
        </section>
      )}

      {/* Customer Addresses Modal/Expansion */}
      {selectedCustomerId && addresses && addresses.length > 0 && (
        <section className="glass-panel p-6 space-y-4">
          <h3 className="text-lg font-semibold text-white/90">Saved Addresses</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {addresses.map((addr) => (
              <div
                key={addr.id}
                className="p-4 bg-white/5 rounded-lg border border-white/10"
              >
                {addr.label && (
                  <p className="text-sm font-medium text-white/90 mb-2">
                    {addr.label} {addr.isDefault && <span className="text-emerald-400">★</span>}
                  </p>
                )}
                <p className="text-sm text-white/70">
                  {addr.street}
                  <br />
                  {addr.city}, {addr.state} {addr.postalCode}
                </p>
                {addr.deliveryInstructions && (
                  <p className="text-xs text-white/50 mt-2 italic">
                    Note: {addr.deliveryInstructions}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
