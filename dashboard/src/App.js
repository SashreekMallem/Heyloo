import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppProviders } from './providers/AppProviders';
import { useAuthStore } from './hooks/useAuthStore';
import { PlatformOverviewPage } from './features/platform/OverviewPage';
import { PlatformRestaurantsPage } from './features/platform/RestaurantsPage';
import { PlatformAnalyticsPage } from './features/platform/AnalyticsPage';
import { PlatformBillingPage } from './features/platform/BillingPage';
import { PlatformTokensPage } from './features/platform/TokensPage';
import { RestaurantOverviewPage } from './features/restaurant/OverviewPage';
import { RestaurantOrdersPage } from './features/restaurant/OrdersPage';
import { RestaurantCallsPage } from './features/restaurant/CallsPage';
import { RestaurantMenuPage } from './features/restaurant/MenuPage';
import { RestaurantCustomersPage } from './features/restaurant/CustomersPage';
import { RestaurantSettingsPage } from './features/restaurant/SettingsPage';
import { LandingPage } from './pages/LandingPageNew';
import PrivacyPolicyPage from './pages/PrivacyPolicyPage';
import TermsPage from './pages/TermsPage';
import SupportPage from './pages/SupportPage';
function RootRedirect() {
    const user = useAuthStore((state) => state.user);
    if (!user) {
        return _jsx(Navigate, { to: "/login", replace: true });
    }
    return user.role === 'platform_admin' ? (_jsx(Navigate, { to: "/platform/overview", replace: true })) : (_jsx(Navigate, { to: "/restaurant/overview", replace: true }));
}
export default function App() {
    return (_jsx(AppProviders, { children: _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(LandingPage, {}) }), _jsx(Route, { path: "/login", element: _jsx(LoginPage, {}) }), _jsx(Route, { path: "/onboarding", element: _jsx(OnboardingPage, {}) }), _jsx(Route, { path: "/privacy", element: _jsx(PrivacyPolicyPage, {}) }), _jsx(Route, { path: "/terms", element: _jsx(TermsPage, {}) }), _jsx(Route, { path: "/support", element: _jsx(SupportPage, {}) }), _jsxs(Route, { element: _jsx(ProtectedRoute, { children: _jsx(AppLayout, {}) }), children: [_jsx(Route, { path: "/platform/overview", element: _jsx(PlatformOverviewPage, {}) }), _jsx(Route, { path: "/platform/restaurants", element: _jsx(PlatformRestaurantsPage, {}) }), _jsx(Route, { path: "/platform/analytics", element: _jsx(PlatformAnalyticsPage, {}) }), _jsx(Route, { path: "/platform/billing", element: _jsx(PlatformBillingPage, {}) }), _jsx(Route, { path: "/platform/tokens", element: _jsx(PlatformTokensPage, {}) }), _jsx(Route, { path: "/restaurant/overview", element: _jsx(RestaurantOverviewPage, {}) }), _jsx(Route, { path: "/restaurant/orders", element: _jsx(RestaurantOrdersPage, {}) }), _jsx(Route, { path: "/restaurant/calls", element: _jsx(RestaurantCallsPage, {}) }), _jsx(Route, { path: "/restaurant/menu", element: _jsx(RestaurantMenuPage, {}) }), _jsx(Route, { path: "/restaurant/customers", element: _jsx(RestaurantCustomersPage, {}) }), _jsx(Route, { path: "/restaurant/settings", element: _jsx(RestaurantSettingsPage, {}) })] }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/", replace: true }) })] }) }));
}
