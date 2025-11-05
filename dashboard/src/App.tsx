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
    return <Navigate to="/login" replace />;
  }

  return user.role === 'platform_admin' ? (
    <Navigate to="/platform/overview" replace />
  ) : (
    <Navigate to="/restaurant/overview" replace />
  );
}

export default function App() {
  return (
    <AppProviders>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/support" element={<SupportPage />} />
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          {/* Removed index route - use explicit paths instead to avoid conflict with "/" */}
          <Route path="/platform/overview" element={<PlatformOverviewPage />} />
          <Route path="/platform/restaurants" element={<PlatformRestaurantsPage />} />
          <Route path="/platform/analytics" element={<PlatformAnalyticsPage />} />
          <Route path="/platform/billing" element={<PlatformBillingPage />} />
          <Route path="/platform/tokens" element={<PlatformTokensPage />} />

          <Route path="/restaurant/overview" element={<RestaurantOverviewPage />} />
          <Route path="/restaurant/orders" element={<RestaurantOrdersPage />} />
          <Route path="/restaurant/calls" element={<RestaurantCallsPage />} />
          <Route path="/restaurant/menu" element={<RestaurantMenuPage />} />
          <Route path="/restaurant/customers" element={<RestaurantCustomersPage />} />
          <Route path="/restaurant/settings" element={<RestaurantSettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppProviders>
  );
}
