import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, User, Cpu, CreditCard, Phone, CheckCircle2 } from 'lucide-react';
import { onboardRestaurant, initiatePosAuth } from '../api/onboarding';
import { useAuthStore } from '../hooks/useAuthStore';
export function OnboardingPage() {
    const navigate = useNavigate();
    const { setAuth } = useAuthStore();
    const [currentStep, setCurrentStep] = useState(1);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [formData, setFormData] = useState({
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
    const [restaurantId, setRestaurantId] = useState(null);
    const steps = [
        { number: 1, title: 'Restaurant Details', icon: Building2 },
        { number: 2, title: 'Admin Account', icon: User },
        { number: 3, title: 'POS Integration', icon: Cpu },
        { number: 4, title: 'Payment Setup', icon: CreditCard },
        { number: 5, title: 'Phone Number', icon: Phone },
        { number: 6, title: 'Complete', icon: CheckCircle2 }
    ];
    const updateFormData = (field, value) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
        setError(null);
    };
    const generateSlug = (name) => {
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
        setCurrentStep((prev) => Math.min(prev + 1, 6));
    };
    const handleBack = () => {
        setCurrentStep((prev) => Math.max(prev - 1, 1));
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
            const authWindow = window.open(authUrl, 'POS OAuth', `width=${width},height=${height},left=${left},top=${top}`);
            // Poll for window close (in production, use postMessage)
            const checkWindow = setInterval(() => {
                if (authWindow?.closed) {
                    clearInterval(checkWindow);
                    updateFormData('posConnected', true);
                    setIsLoading(false);
                }
            }, 1000);
        }
        catch (err) {
            setError(err.response?.data?.message || 'Failed to connect POS');
            setIsLoading(false);
        }
    };
    const handleSubmit = async () => {
        try {
            setIsLoading(true);
            setError(null);
            const payload = {
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
        }
        catch (err) {
            setError(err.response?.data?.message || 'Onboarding failed. Please try again.');
            setIsLoading(false);
        }
    };
    const renderStepContent = () => {
        switch (currentStep) {
            case 1:
                return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-white/70 mb-2", children: "Restaurant Name *" }), _jsx("input", { type: "text", value: formData.restaurantName, onChange: (e) => {
                                        updateFormData('restaurantName', e.target.value);
                                        if (!formData.restaurantSlug) {
                                            generateSlug(e.target.value);
                                        }
                                    }, className: "w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30", placeholder: "Imperial Biryani Cafe" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-white/70 mb-2", children: "URL Slug *" }), _jsx("input", { type: "text", value: formData.restaurantSlug, onChange: (e) => updateFormData('restaurantSlug', e.target.value), className: "w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30", placeholder: "imperial-biryani-cafe" }), _jsxs("p", { className: "text-xs text-white/50 mt-1", children: ["https://heyloo.ai/", formData.restaurantSlug || 'your-restaurant'] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-white/70 mb-2", children: "Owner Email *" }), _jsx("input", { type: "email", value: formData.ownerEmail, onChange: (e) => updateFormData('ownerEmail', e.target.value), className: "w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30", placeholder: "owner@restaurant.com" })] }), _jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-white/70 mb-2", children: "Tax Rate (%)" }), _jsx("input", { type: "number", step: "0.0001", value: formData.taxRate * 100, onChange: (e) => updateFormData('taxRate', parseFloat(e.target.value) / 100), className: "w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-white/70 mb-2", children: "Delivery Fee ($)" }), _jsx("input", { type: "number", step: "0.01", value: formData.deliveryFee, onChange: (e) => updateFormData('deliveryFee', parseFloat(e.target.value)), className: "w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30" })] })] })] }));
            case 2:
                return (_jsxs("div", { className: "space-y-6", children: [_jsx("div", { className: "bg-white/5 border border-white/10 rounded-xl p-4", children: _jsx("p", { className: "text-sm text-white/70", children: "This will be your admin account to access the restaurant dashboard." }) }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-white/70 mb-2", children: "Email (Admin Login)" }), _jsx("input", { type: "email", value: formData.ownerEmail, disabled: true, className: "w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white/50" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-white/70 mb-2", children: "Password * (min. 8 characters)" }), _jsx("input", { type: "password", value: formData.adminPassword, onChange: (e) => updateFormData('adminPassword', e.target.value), className: "w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30", placeholder: "Enter password" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-white/70 mb-2", children: "Confirm Password *" }), _jsx("input", { type: "password", value: formData.adminPasswordConfirm, onChange: (e) => updateFormData('adminPasswordConfirm', e.target.value), className: "w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30", placeholder: "Confirm password" })] })] }));
            case 3:
                return (_jsxs("div", { className: "space-y-6", children: [_jsx("div", { className: "bg-white/5 border border-white/10 rounded-xl p-4", children: _jsx("p", { className: "text-sm text-white/70", children: "Connect your POS system to automatically sync menu items and push orders." }) }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-white/70 mb-3", children: "Select POS System" }), _jsx("div", { className: "grid grid-cols-2 gap-3", children: [
                                        { value: 'square', label: 'Square' },
                                        { value: 'toast', label: 'Toast' },
                                        { value: 'clover', label: 'Clover' },
                                        { value: 'none', label: 'None (Manual)' }
                                    ].map((pos) => (_jsx("button", { type: "button", onClick: () => updateFormData('posType', pos.value), className: `px-6 py-4 rounded-xl border-2 font-medium transition-all ${formData.posType === pos.value
                                            ? 'bg-white text-slate-900 border-white shadow-lg'
                                            : 'bg-white/10 text-white border-white/20 hover:bg-white/20'}`, children: pos.label }, pos.value))) })] }), formData.posType !== 'none' && (_jsx("div", { children: formData.posConnected ? (_jsxs("div", { className: "bg-emerald-500/20 border border-emerald-500/30 rounded-xl p-4 flex items-center gap-3", children: [_jsx(CheckCircle2, { className: "h-5 w-5 text-emerald-400" }), _jsxs("span", { className: "text-sm text-emerald-300", children: [formData.posType.charAt(0).toUpperCase() + formData.posType.slice(1), " connected successfully"] })] })) : (_jsx("button", { type: "button", onClick: handlePosConnect, disabled: isLoading, className: "w-full px-6 py-4 bg-white text-slate-900 rounded-xl font-medium hover:bg-white/90 transition-all disabled:opacity-50", children: isLoading ? 'Connecting...' : `Connect ${formData.posType.charAt(0).toUpperCase() + formData.posType.slice(1)}` })) }))] }));
            case 4:
                return (_jsxs("div", { className: "space-y-6", children: [_jsx("div", { className: "bg-white/5 border border-white/10 rounded-xl p-4", children: _jsx("p", { className: "text-sm text-white/70", children: "Connect Stripe to accept payments. You can skip this step and set it up later." }) }), _jsxs("div", { className: "text-center py-8", children: [_jsx(CreditCard, { className: "h-16 w-16 text-white/40 mx-auto mb-4" }), _jsx("h3", { className: "text-lg font-semibold text-white mb-2", children: "Stripe Connect" }), _jsx("p", { className: "text-sm text-white/60 mb-6", children: "Payment processing will be set up via Stripe Connect" }), _jsx("button", { type: "button", className: "px-6 py-3 bg-white/10 border border-white/20 rounded-xl text-white hover:bg-white/20 transition-all", children: "Connect Stripe Account" }), _jsx("p", { className: "text-xs text-white/50 mt-4", children: "Or skip and configure later in settings" })] })] }));
            case 5:
                return (_jsxs("div", { className: "space-y-6", children: [_jsx("div", { className: "bg-white/5 border border-white/10 rounded-xl p-4", children: _jsx("p", { className: "text-sm text-white/70", children: "You can provide an existing number or we'll provision a VAPI phone number for you." }) }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-white/70 mb-2", children: "Phone Number (Optional)" }), _jsx("input", { type: "tel", value: formData.phoneNumber, onChange: (e) => updateFormData('phoneNumber', e.target.value), className: "w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30", placeholder: "+1 (555) 123-4567 or leave blank to provision" })] }), _jsxs("div", { className: "bg-white/5 border border-white/10 rounded-xl p-4", children: [_jsx("h4", { className: "text-sm font-semibold text-white mb-2", children: "What happens next?" }), _jsxs("ul", { className: "space-y-2 text-sm text-white/70", children: [_jsxs("li", { className: "flex items-start gap-2", children: [_jsx(CheckCircle2, { className: "h-4 w-4 text-emerald-400 mt-0.5 flex-shrink-0" }), _jsx("span", { children: "Your restaurant account will be created" })] }), _jsxs("li", { className: "flex items-start gap-2", children: [_jsx(CheckCircle2, { className: "h-4 w-4 text-emerald-400 mt-0.5 flex-shrink-0" }), _jsx("span", { children: "Universal AI assistant will be configured for your restaurant" })] }), _jsxs("li", { className: "flex items-start gap-2", children: [_jsx(CheckCircle2, { className: "h-4 w-4 text-emerald-400 mt-0.5 flex-shrink-0" }), _jsx("span", { children: "Multi-tenant isolation will be automatically enabled" })] }), _jsxs("li", { className: "flex items-start gap-2", children: [_jsx(CheckCircle2, { className: "h-4 w-4 text-emerald-400 mt-0.5 flex-shrink-0" }), _jsx("span", { children: "You'll get immediate access to your dashboard" })] })] })] })] }));
            case 6:
                return (_jsxs("div", { className: "text-center py-12", children: [_jsx("div", { className: "bg-emerald-500/20 border-2 border-emerald-500/30 rounded-full h-24 w-24 mx-auto mb-6 flex items-center justify-center", children: _jsx(CheckCircle2, { className: "h-12 w-12 text-emerald-400" }) }), _jsx("h2", { className: "text-3xl font-bold text-white mb-3", children: "All Set!" }), _jsx("p", { className: "text-white/70 mb-8 max-w-md mx-auto", children: "Your restaurant is onboarded and ready to start taking voice orders." }), _jsx("button", { type: "button", onClick: () => navigate('/restaurant/overview'), className: "px-8 py-4 bg-white text-slate-900 rounded-xl font-semibold hover:bg-white/90 transition-all", children: "Go to Dashboard" })] }));
            default:
                return null;
        }
    };
    return (_jsx("div", { className: "min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-6", children: _jsxs("div", { className: "w-full max-w-4xl", children: [_jsxs("div", { className: "text-center mb-12", children: [_jsx("h1", { className: "text-4xl font-bold text-white mb-3", children: "Restaurant Onboarding" }), _jsx("p", { className: "text-white/60", children: "Set up your voice AI restaurant in minutes" })] }), currentStep < 6 && (_jsx("div", { className: "mb-12", children: _jsxs("div", { className: "flex items-center justify-between relative", children: [steps.slice(0, 5).map((step, index) => (_jsxs("div", { className: "flex flex-col items-center relative z-10", children: [_jsx("div", { className: `h-12 w-12 rounded-full flex items-center justify-center border-2 transition-all ${step.number === currentStep
                                            ? 'bg-white text-slate-900 border-white'
                                            : step.number < currentStep
                                                ? 'bg-emerald-500 text-white border-emerald-500'
                                                : 'bg-white/10 text-white/40 border-white/20'}`, children: step.number < currentStep ? (_jsx(CheckCircle2, { className: "h-5 w-5" })) : (_jsx(step.icon, { className: "h-5 w-5" })) }), _jsx("span", { className: "text-xs text-white/70 mt-2 absolute -bottom-6 whitespace-nowrap", children: step.title })] }, step.number))), _jsx("div", { className: "absolute top-6 left-0 right-0 h-0.5 bg-white/10 -z-0" }), _jsx("div", { className: "absolute top-6 left-0 h-0.5 bg-emerald-500 transition-all -z-0", style: { width: `${((currentStep - 1) / 4) * 100}%` } })] }) })), _jsxs("div", { className: "bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl", children: [error && (_jsx("div", { className: "bg-rose-500/20 border border-rose-500/30 rounded-xl p-4 mb-6", children: _jsx("p", { className: "text-sm text-rose-300", children: error }) })), renderStepContent(), currentStep < 6 && (_jsxs("div", { className: "flex items-center justify-between mt-8 pt-6 border-t border-white/10", children: [_jsx("button", { type: "button", onClick: handleBack, disabled: currentStep === 1, className: "px-6 py-3 bg-white/10 border border-white/20 rounded-xl text-white hover:bg-white/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed", children: "Back" }), _jsx("button", { type: "button", onClick: handleNext, disabled: isLoading, className: "px-8 py-3 bg-white text-slate-900 rounded-xl font-semibold hover:bg-white/90 transition-all disabled:opacity-50", children: isLoading ? 'Processing...' : currentStep === 5 ? 'Complete Onboarding' : 'Continue' })] }))] })] }) }));
}
