import { NavLink, Outlet } from 'react-router-dom';
import { BarChart3, PhoneCall, ShoppingBag, Layers3, LogOut, Key, Users, Settings } from 'lucide-react';

import { useAuthStore } from '../hooks/useAuthStore';

const platformNav = [
  { to: '/platform/overview', label: 'Overview', icon: Layers3 },
  { to: '/platform/restaurants', label: 'Restaurants', icon: ShoppingBag },
  { to: '/platform/analytics', label: 'Usage Analytics', icon: BarChart3 },
  { to: '/platform/billing', label: 'Billing', icon: PhoneCall },
  { to: '/platform/tokens', label: 'API Tokens', icon: Key }
];

const restaurantNav = [
  { to: '/restaurant/overview', label: 'Overview', icon: Layers3 },
  { to: '/restaurant/orders', label: 'Orders', icon: ShoppingBag },
  { to: '/restaurant/calls', label: 'Calls', icon: PhoneCall },
  { to: '/restaurant/menu', label: 'Menu', icon: BarChart3 },
  { to: '/restaurant/customers', label: 'Customers', icon: Users },
  { to: '/restaurant/settings', label: 'Settings', icon: Settings }
];

export function AppLayout() {
  const { user, logout } = useAuthStore();

  if (!user) {
    return null;
  }

  const navItems = user.role === 'platform_admin' ? platformNav : restaurantNav;

  return (
    <div className="min-h-screen flex text-slate-100">
      <aside className="w-72 bg-slate-900/80 backdrop-blur-xl border-r border-white/10 p-8 flex flex-col">
        <div className="flex items-center gap-3 mb-8">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center font-semibold">
            HV
          </div>
          <div>
            <p className="text-sm text-white/60">Heyloo Voice Platform</p>
            <p className="text-white font-semibold">{user.email}</p>
          </div>
        </div>

        <nav className="flex-1 flex flex-col gap-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                [
                  'flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200',
                  isActive
                    ? 'bg-white/20 text-white shadow-lg'
                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                ].join(' ')
              }
            >
              <item.icon className="h-5 w-5" />
              <span className="font-medium">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <button
          type="button"
          onClick={logout}
          className="mt-8 flex items-center gap-3 px-4 py-3 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-all"
        >
          <LogOut className="h-5 w-5" />
          Sign out
        </button>
      </aside>

      <main className="flex-1 p-10 bg-slate-900/40 backdrop-blur-xl">
        <Outlet />
      </main>
    </div>
  );
}
