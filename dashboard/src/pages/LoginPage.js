import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '../api/auth';
import { useAuthStore } from '../hooks/useAuthStore';
export function LoginPage() {
    const navigate = useNavigate();
    const setAuth = useAuthStore((state) => state.setAuth);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const handleSubmit = async (event) => {
        event.preventDefault();
        setLoading(true);
        setError(null);
        try {
            console.log('🔵 [Login] Attempting login', { email });
            const response = await login({ email, password });
            console.log('🟢 [Login] SUCCESS', {
                hasAccessToken: !!response.accessToken,
                hasRefreshToken: !!response.refreshToken,
                user: response.user,
                tokenPrefix: response.accessToken?.substring(0, 20)
            });
            setAuth({
                accessToken: response.accessToken,
                refreshToken: response.refreshToken,
                user: {
                    id: response.user.id,
                    email: response.user.email,
                    role: response.user.role,
                    restaurantId: response.user.restaurantId
                }
            });
            console.log('🟢 [Login] Auth state saved', {
                storedState: useAuthStore.getState()
            });
            // Redirect to appropriate dashboard based on role
            if (response.user.role === 'platform_admin') {
                navigate('/platform/overview');
            }
            else {
                navigate('/restaurant/overview');
            }
        }
        catch (err) {
            console.error('Login error:', err);
            const errorMessage = err?.response?.data?.message || err?.message || 'Login failed. Please check your credentials.';
            setError(errorMessage);
        }
        finally {
            setLoading(false);
        }
    };
    return (_jsxs("div", { className: "min-h-screen flex items-center justify-center bg-slate-950 relative overflow-hidden", children: [_jsx("div", { className: "absolute inset-0", children: _jsx("div", { className: "absolute inset-0 bg-gradient-to-tr from-indigo-500/20 via-slate-900 to-purple-500/20 blur-3xl" }) }), _jsxs("div", { className: "relative glass-panel max-w-md w-full p-10 space-y-8", children: [_jsxs("div", { className: "space-y-3", children: [_jsx("p", { className: "text-sm uppercase tracking-[0.3rem] text-white/60", children: "Heyloo Voice Platform" }), _jsx("h1", { className: "text-3xl font-bold text-white", children: "Sign in to your workspace" }), _jsx("p", { className: "text-white/60", children: "Enter your credentials to access analytics, orders, and call performance." })] }), _jsxs("form", { className: "space-y-6", onSubmit: handleSubmit, children: [_jsxs("div", { className: "space-y-4", children: [_jsxs("label", { className: "block space-y-2", children: [_jsx("span", { className: "text-sm text-white/70", children: "Email address" }), _jsx("input", { type: "email", value: email, onChange: (event) => setEmail(event.target.value), className: "w-full rounded-xl bg-white/10 border border-white/10 px-4 py-3 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-indigo-500/60", placeholder: "you@restaurant.com", required: true })] }), _jsxs("label", { className: "block space-y-2", children: [_jsx("span", { className: "text-sm text-white/70", children: "Password" }), _jsx("input", { type: "password", value: password, onChange: (event) => setPassword(event.target.value), className: "w-full rounded-xl bg-white/10 border border-white/10 px-4 py-3 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-indigo-500/60", placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", required: true })] })] }), error ? (_jsx("p", { className: "text-sm text-rose-300/90 bg-rose-500/10 border border-rose-500/20 px-4 py-2 rounded-xl", children: error })) : null, _jsx("button", { type: "submit", disabled: loading, className: "w-full py-3 rounded-xl font-semibold bg-gradient-to-r from-indigo-500 via-sky-500 to-purple-500 text-white shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 transition-all disabled:opacity-60", children: loading ? 'Signing you in…' : 'Sign in' })] }), _jsxs("p", { className: "text-xs text-center text-white/40", children: ["Need help? Email", ' ', _jsx("a", { href: "mailto:support@heyloo.ai", className: "text-white/60 hover:text-white", children: "support@heyloo.ai" })] })] })] }));
}
