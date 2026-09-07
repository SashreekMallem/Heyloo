import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, User, Cpu, CreditCard, Phone, CheckCircle2 } from 'lucide-react';

import { onboardRestaurant, initiatePosAuth, type OnboardingPayload } from '../api/onboarding';
import { useAuthStore } from '../hooks/useAuthStore';

type OnboardingStep = 1 | 2 | 3 | 4 | 5 | 6;

type OnboardingFormData = {
  // Step 1: Restaurant Details
  restaurantName: string;
  restaurantSlug: string;
  ownerEmail: string;
  taxRate: number;
  deliveryFee: number;

  // Step 2: Admin User
  adminPassword: string;
  adminPasswordConfirm: string;

  // Step 3: POS Connection
  posType: 'square' | 'toast' | 'clover' | 'none';
  posConnected: boolean;

  // Step 4: Payment Setup (optional)
  stripeConnected: boolean;

  // Step 5: Phone Number (optional)
  phoneNumber: string;
};

export function OnboardingPage() {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  
  const [currentStep, setCurrentStep] = useState<OnboardingStep>(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [formData, setFormData] = useState<OnboardingFormData>({
    restaurantName: '',
    restaurantSlug: '',
    ownerEmail: '',
    taxRate: 0.0825,
    deliveryFee: 5.0,
    adminPassword: '',
    adminPasswordConfirm: '',
    posType: 'none',
    posConnected: false,
    stripeConnected: false,
    phoneNumber: ''
  });

  const [restaurantId, setRestaurantId] = useState<string | null>(null);

  const steps = [
    { number: 1, title: 'Restaurant Details', icon: Building2 },
    { number: 2, title: 'Admin Account', icon: User },
    { number: 3, title: 'POS Integration', icon: Cpu },
    { number: 4, title: 'Payment Setup', icon: CreditCard },
    { number: 5, title: 'Phone Number', icon: Phone },
    { number: 6, title: 'Complete', icon: CheckCircle2 }
  ];

  const updateFormData = (field: keyof OnboardingFormData, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setError(null);
  };

  const generateSlug = (name: string) => {
    const slug = name
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
    updateFormData('restaurantSlug', slug);
  };

  const handleNext = async () => {
    setError(null);

    // Validation for each step
    if (currentStep === 1) {
      if (!formData.restaurantName || !formData.ownerEmail) {
        setError('Please fill in all required fields');
        return;
      }
      if (!formData.restaurantSlug) {
        generateSlug(formData.restaurantName);
      }
    }

    if (currentStep === 2) {
      if (!formData.adminPassword || formData.adminPassword.length < 8) {
        setError('Password must be at least 8 characters');
        return;
      }
      if (formData.adminPassword !== formData.adminPasswordConfirm) {
        setError('Passwords do not match');
        return;
      }
    }

    if (currentStep === 5) {
      // Final step - submit onboarding
      await handleSubmit();
      return;
    }

    setCurrentStep((prev) => Math.min(prev + 1, 6) as OnboardingStep);
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1) as OnboardingStep);
    setError(null);
  };

  const handlePosConnect = async () => {
    if (formData.posType === 'none') {
      updateFormData('posConnected', false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      // Get OAuth URL
      const { authUrl } = await initiatePosAuth(formData.posType, restaurantId ?? 'temp');
      
      // Open OAuth in new window
      const width = 600;
      const height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;
      
      const authWindow = window.open(
        authUrl,
        'POS OAuth',
        `width=${width},height=${height},left=${left},top=${top}`
      );

      // Poll for window close (in production, use postMessage)
      const checkWindow = setInterval(() => {
        if (authWindow?.closed) {
          clearInterval(checkWindow);
          updateFormData('posConnected', true);
          setIsLoading(false);
        }
      }, 1000);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to connect POS');
      setIsLoading(false);
    }
  };

  const handleSubmit = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const payload: OnboardingPayload = {
        restaurantName: formData.restaurantName,
        restaurantSlug: formData.restaurantSlug,
        ownerEmail: formData.ownerEmail,
        phoneNumber: formData.phoneNumber || undefined,
        taxRate: formData.taxRate,
        deliveryFee: formData.deliveryFee,
        adminPassword: formData.adminPassword,
        posType: formData.posType
      };

      const result = await onboardRestaurant(payload);

      // Set auth tokens and redirect to dashboard
      setAuth({
        accessToken: result.auth.accessToken,
        refreshToken: result.auth.refreshToken,
        user: {
          id: result.admin.id,
          email: result.admin.email,
          role: 'restaurant_admin',
          restaurantId: result.restaurant.id
        }
      });

      setRestaurantId(result.restaurant.id);
      setCurrentStep(6); // Show success screen
    } catch (err: any) {
      setError(err.response?.data?.message || 'Onboarding failed. Please try again.');
      setIsLoading(false);
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">
                Restaurant Name *
              </label>
              <input
                type="text"
                value={formData.restaurantName}
                onChange={(e) => {
                  updateFormData('restaurantName', e.target.value);
                  if (!formData.restaurantSlug) {
                    generateSlug(e.target.value);
                  }
                }}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
                placeholder="Imperial Biryani Cafe"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">
                URL Slug *
              </label>
              <input
                type="text"
                value={formData.restaurantSlug}
                onChange={(e) => updateFormData('restaurantSlug', e.target.value)}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
                placeholder="imperial-biryani-cafe"
              />
              <p className="text-xs text-white/50 mt-1">
                https://heyloo.ai/{formData.restaurantSlug || 'your-restaurant'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">
                Owner Email *
              </label>
              <input
                type="email"
                value={formData.ownerEmail}
                onChange={(e) => updateFormData('ownerEmail', e.target.value)}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
                placeholder="owner@restaurant.com"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  Tax Rate (%)
                </label>
                <input
                  type="number"
                  step="0.0001"
                  value={formData.taxRate * 100}
                  onChange={(e) => updateFormData('taxRate', parseFloat(e.target.value) / 100)}
                  className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  Delivery Fee ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.deliveryFee}
                  onChange={(e) => updateFormData('deliveryFee', parseFloat(e.target.value))}
                  className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
                />
              </div>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-6">
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <p className="text-sm text-white/70">
                This will be your admin account to access the restaurant dashboard.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">
                Email (Admin Login)
              </label>
              <input
                type="email"
                value={formData.ownerEmail}
                disabled
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white/50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">
                Password * (min. 8 characters)
              </label>
              <input
                type="password"
                value={formData.adminPassword}
                onChange={(e) => updateFormData('adminPassword', e.target.value)}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
                placeholder="Enter password"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">
                Confirm Password *
              </label>
              <input
                type="password"
                value={formData.adminPasswordConfirm}
                onChange={(e) => updateFormData('adminPasswordConfirm', e.target.value)}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
                placeholder="Confirm password"
              />
            </div>
          </div>
        );

      case 3:
        return (
          <div className="space-y-6">
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <p className="text-sm text-white/70">
                Connect your POS system to automatically sync menu items and push orders.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-3">
                Select POS System
              </label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: 'square', label: 'Square' },
                  { value: 'toast', label: 'Toast' },
                  { value: 'clover', label: 'Clover' },
                  { value: 'none', label: 'None (Manual)' }
                ].map((pos) => (
                  <button
                    key={pos.value}
                    type="button"
                    onClick={() => updateFormData('posType', pos.value)}
                    className={`px-6 py-4 rounded-xl border-2 font-medium transition-all ${
                      formData.posType === pos.value
                        ? 'bg-white text-slate-900 border-white shadow-lg'
                        : 'bg-white/10 text-white border-white/20 hover:bg-white/20'
                    }`}
                  >
                    {pos.label}
                  </button>
                ))}
              </div>
            </div>

            {formData.posType !== 'none' && (
              <div>
                {formData.posConnected ? (
                  <div className="bg-emerald-500/20 border border-emerald-500/30 rounded-xl p-4 flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                    <span className="text-sm text-emerald-300">
                      {formData.posType.charAt(0).toUpperCase() + formData.posType.slice(1)} connected successfully
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handlePosConnect}
                    disabled={isLoading}
                    className="w-full px-6 py-4 bg-white text-slate-900 rounded-xl font-medium hover:bg-white/90 transition-all disabled:opacity-50"
                  >
                    {isLoading ? 'Connecting...' : `Connect ${formData.posType.charAt(0).toUpperCase() + formData.posType.slice(1)}`}
                  </button>
                )}
              </div>
            )}
          </div>
        );

      case 4:
        return (
          <div className="space-y-6">
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <p className="text-sm text-white/70">
                Connect Stripe to accept payments. You can skip this step and set it up later.
              </p>
            </div>

            <div className="text-center py-8">
              <CreditCard className="h-16 w-16 text-white/40 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">Stripe Connect</h3>
              <p className="text-sm text-white/60 mb-6">
                Payment processing will be set up via Stripe Connect
              </p>
              <button
                type="button"
                className="px-6 py-3 bg-white/10 border border-white/20 rounded-xl text-white hover:bg-white/20 transition-all"
              >
                Connect Stripe Account
              </button>
              <p className="text-xs text-white/50 mt-4">
                Or skip and configure later in settings
              </p>
            </div>
          </div>
        );

      case 5:
        return (
          <div className="space-y-6">
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <p className="text-sm text-white/70">
                You can provide an existing number or we'll provision a VAPI phone number for you.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">
                Phone Number (Optional)
              </label>
              <input
                type="tel"
                value={formData.phoneNumber}
                onChange={(e) => updateFormData('phoneNumber', e.target.value)}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
                placeholder="+1 (555) 123-4567 or leave blank to provision"
              />
            </div>

            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-white mb-2">What happens next?</h4>
              <ul className="space-y-2 text-sm text-white/70">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                  <span>Your restaurant account will be created</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                  <span>Universal AI assistant will be configured for your restaurant</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                  <span>Multi-tenant isolation will be automatically enabled</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                  <span>You'll get immediate access to your dashboard</span>
                </li>
              </ul>
            </div>
          </div>
        );

      case 6:
        return (
          <div className="text-center py-12">
            <div className="bg-emerald-500/20 border-2 border-emerald-500/30 rounded-full h-24 w-24 mx-auto mb-6 flex items-center justify-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-400" />
            </div>
            <h2 className="text-3xl font-bold text-white mb-3">All Set!</h2>
            <p className="text-white/70 mb-8 max-w-md mx-auto">
              Your restaurant is onboarded and ready to start taking voice orders.
            </p>
            <button
              type="button"
              onClick={() => navigate('/restaurant/overview')}
              className="px-8 py-4 bg-white text-slate-900 rounded-xl font-semibold hover:bg-white/90 transition-all"
            >
              Go to Dashboard
            </button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-6">
      <div className="w-full max-w-4xl">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-white mb-3">Restaurant Onboarding</h1>
          <p className="text-white/60">Set up your voice AI restaurant in minutes</p>
        </div>

        {/* Progress Steps */}
        {currentStep < 6 && (
          <div className="mb-12">
            <div className="flex items-center justify-between relative">
              {steps.slice(0, 5).map((step, index) => (
                <div key={step.number} className="flex flex-col items-center relative z-10">
                  <div
                    className={`h-12 w-12 rounded-full flex items-center justify-center border-2 transition-all ${
                      step.number === currentStep
                        ? 'bg-white text-slate-900 border-white'
                        : step.number < currentStep
                        ? 'bg-emerald-500 text-white border-emerald-500'
                        : 'bg-white/10 text-white/40 border-white/20'
                    }`}
                  >
                    {step.number < currentStep ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : (
                      <step.icon className="h-5 w-5" />
                    )}
                  </div>
                  <span className="text-xs text-white/70 mt-2 absolute -bottom-6 whitespace-nowrap">
                    {step.title}
                  </span>
                </div>
              ))}
              {/* Connecting Line */}
              <div className="absolute top-6 left-0 right-0 h-0.5 bg-white/10 -z-0" />
              <div
                className="absolute top-6 left-0 h-0.5 bg-emerald-500 transition-all -z-0"
                style={{ width: `${((currentStep - 1) / 4) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Main Form */}
        <div className="bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
          {error && (
            <div className="bg-rose-500/20 border border-rose-500/30 rounded-xl p-4 mb-6">
              <p className="text-sm text-rose-300">{error}</p>
            </div>
          )}

          {renderStepContent()}

          {/* Navigation Buttons */}
          {currentStep < 6 && (
            <div className="flex items-center justify-between mt-8 pt-6 border-t border-white/10">
              <button
                type="button"
                onClick={handleBack}
                disabled={currentStep === 1}
                className="px-6 py-3 bg-white/10 border border-white/20 rounded-xl text-white hover:bg-white/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleNext}
                disabled={isLoading}
                className="px-8 py-3 bg-white text-slate-900 rounded-xl font-semibold hover:bg-white/90 transition-all disabled:opacity-50"
              >
                {isLoading ? 'Processing...' : currentStep === 5 ? 'Complete Onboarding' : 'Continue'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

