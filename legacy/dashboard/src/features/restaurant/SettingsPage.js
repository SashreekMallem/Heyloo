import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Save, Building2, RefreshCw, Link2, Unlink, CheckCircle2, MapPin, Clock, Users, FileText, Truck, X } from 'lucide-react';
import { useAuthStore } from '../../hooks/useAuthStore';
import { api } from '../../api/client';
import { initiatePosAuth, getPosLocations, finalizePosConnection } from '../../api/onboarding';
import { triggerMenuSync } from '../../api/pos';
const DAYS_OF_WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
export function RestaurantSettingsPage() {
    const { user } = useAuthStore();
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [isSaving, setIsSaving] = useState(false);
    const [isConnectingPos, setIsConnectingPos] = useState(false);
    const [successMessage, setSuccessMessage] = useState(null);
    const [errorMessage, setErrorMessage] = useState(null);
    // Location selection state for multi-location POS
    const [showLocationSelector, setShowLocationSelector] = useState(false);
    const [posAuthProvider, setPosAuthProvider] = useState(null);
    const [posAuthSession, setPosAuthSession] = useState(null);
    const [availableLocations, setAvailableLocations] = useState([]);
    const [availableMerchants, setAvailableMerchants] = useState([]);
    const [selectedLocationIds, setSelectedLocationIds] = useState([]);
    const [selectedMerchantIds, setSelectedMerchantIds] = useState([]);
    const [isFinalizing, setIsFinalizing] = useState(false);
    const { data: restaurant, isLoading } = useQuery({
        queryKey: ['restaurant-details', user?.restaurantId],
        queryFn: async () => {
            const { data } = await api.get(`/restaurants/${user.restaurantId}`);
            return data;
        },
        enabled: !!user?.restaurantId
    });
    const { data: posConfig } = useQuery({
        queryKey: ['pos-config', user?.restaurantId],
        queryFn: async () => {
            const { data } = await api.get(`/restaurants/${user.restaurantId}/pos-config`);
            return data;
        },
        enabled: !!user?.restaurantId
    });
    const [formData, setFormData] = useState({
        name: '',
        phoneNumber: '',
        assistantName: '',
        taxRate: 0,
        deliveryFee: 0,
        posType: 'none',
        posLocationId: '',
        // Address
        addressStreet: '',
        addressCity: '',
        addressState: '',
        addressZip: '',
        // Business hours
        businessHours: {},
        // Contact
        managerName: '',
        managerPhone: '',
        supportEmail: '',
        // Delivery & ordering
        deliveryRadiusMiles: 5,
        minimumOrderAmount: 0,
        estimatedPrepTimeMinutes: 30,
        acceptsCash: true,
        acceptsCard: true,
        // Additional info
        specialInstructions: '',
        parkingInfo: '',
        accessibilityNotes: ''
    });
    // Check for OAuth callback redirect
    useEffect(() => {
        const posAuth = searchParams.get('pos_auth');
        const session = searchParams.get('session');
        const posConnected = searchParams.get('pos_connected');
        const posError = searchParams.get('pos_error');
        console.log('[POS OAuth useEffect]', {
            posAuth,
            session,
            posConnected,
            posError,
            hasOpener: !!window.opener,
            currentUrl: window.location.href
        });
        // Handle errors
        if (posError) {
            console.log('[POS OAuth] Error detected:', posError);
            setErrorMessage(decodeURIComponent(posError));
            setIsConnectingPos(false);
            searchParams.delete('pos_error');
            setSearchParams(searchParams, { replace: true });
            return;
        }
        // If we're in a popup (opener exists), notify parent window and close
        if (window.opener && (posAuth || posConnected)) {
            console.log('[POS OAuth] In popup, sending postMessage to parent');
            // Send postMessage multiple times to ensure parent receives it
            const sendMessage = () => {
                if (window.opener) {
                    window.opener.postMessage({
                        type: 'pos_oauth_complete',
                        provider: posAuth || posConnected,
                        session
                    }, '*'); // Use * for broader compatibility with ngrok URLs
                    console.log('[POS OAuth] postMessage sent from popup');
                }
            };
            // Send immediately
            sendMessage();
            // Send again after a short delay to ensure delivery
            setTimeout(sendMessage, 50);
            setTimeout(sendMessage, 200);
            // Close popup after ensuring message is sent
            setTimeout(() => {
                window.close();
            }, 300);
            // Don't process in popup - let parent handle it
            return;
        }
        // Handle location selection for multi-location providers (only in parent window)
        if (posAuth && session && (posAuth === 'square' || posAuth === 'clover')) {
            console.log('[POS OAuth] Showing location selector', { posAuth, session });
            setPosAuthProvider(posAuth);
            setPosAuthSession(session);
            setShowLocationSelector(true);
            setIsConnectingPos(false);
            // Fetch available locations
            console.log('[POS OAuth useEffect] Fetching locations from API', { posAuth, session });
            getPosLocations(posAuth, session)
                .then((result) => {
                console.log('[POS OAuth useEffect] Locations fetched successfully', {
                    locationCount: result.locations?.length || 0,
                    merchantCount: result.merchants?.length || 0,
                    locations: result.locations,
                    merchants: result.merchants
                });
                if (result.locations && result.locations.length > 0) {
                    setAvailableLocations(result.locations);
                    console.log('[POS OAuth useEffect] Set available locations', result.locations.length);
                }
                if (result.merchants && result.merchants.length > 0) {
                    setAvailableMerchants(result.merchants);
                    console.log('[POS OAuth useEffect] Set available merchants', result.merchants.length);
                }
                // If no locations/merchants found, show error
                if ((!result.locations || result.locations.length === 0) && (!result.merchants || result.merchants.length === 0)) {
                    console.error('[POS OAuth useEffect] No locations/merchants found in result');
                    setErrorMessage('No locations found. Please try connecting again.');
                    setShowLocationSelector(false);
                    searchParams.delete('pos_auth');
                    searchParams.delete('session');
                    setSearchParams(searchParams, { replace: true });
                }
                else {
                    console.log('[POS OAuth useEffect] Location selector should now be visible');
                }
            })
                .catch((err) => {
                console.error('[POS OAuth useEffect] Failed to fetch locations', {
                    error: err,
                    message: err.message,
                    stack: err.stack,
                    response: err.response?.data
                });
                setErrorMessage('Failed to load locations. Please try again.');
                setShowLocationSelector(false);
                setIsConnectingPos(false);
                searchParams.delete('pos_auth');
                searchParams.delete('session');
                setSearchParams(searchParams, { replace: true });
            });
            return;
        }
        // Handle successful auto-connect
        if (posConnected) {
            const provider = posConnected;
            setSuccessMessage(`${provider.charAt(0).toUpperCase()}${provider.slice(1)} connected successfully!`);
            setIsConnectingPos(false);
            // Refresh POS config and restaurant data immediately
            queryClient.invalidateQueries({ queryKey: ['pos-config', user?.restaurantId] });
            queryClient.invalidateQueries({ queryKey: ['restaurant-details', user?.restaurantId] });
            // Refetch immediately to update UI
            queryClient.refetchQueries({ queryKey: ['pos-config', user?.restaurantId] });
            queryClient.refetchQueries({ queryKey: ['restaurant-details', user?.restaurantId] });
            // Clean up URL params
            searchParams.delete('pos_connected');
            setSearchParams(searchParams, { replace: true });
        }
    }, [searchParams, queryClient, user?.restaurantId, setSearchParams]);
    // Load restaurant data into form
    if (restaurant && !formData.name) {
        setFormData({
            name: restaurant.name || '',
            phoneNumber: restaurant.phone_number || '',
            assistantName: restaurant.assistant_name || '',
            taxRate: restaurant.tax_rate || 0,
            deliveryFee: restaurant.delivery_fee || 0,
            posType: restaurant.pos_type || 'none',
            posLocationId: restaurant.pos_location_id || '',
            addressStreet: restaurant.address_street || '',
            addressCity: restaurant.address_city || '',
            addressState: restaurant.address_state || '',
            addressZip: restaurant.address_zip || '',
            businessHours: restaurant.business_hours || {},
            managerName: restaurant.manager_name || '',
            managerPhone: restaurant.manager_phone || '',
            supportEmail: restaurant.support_email || '',
            deliveryRadiusMiles: restaurant.delivery_radius_miles || 5,
            minimumOrderAmount: restaurant.minimum_order_amount || 0,
            estimatedPrepTimeMinutes: restaurant.estimated_prep_time_minutes || 30,
            acceptsCash: restaurant.accepts_cash ?? true,
            acceptsCard: restaurant.accepts_card ?? true,
            specialInstructions: restaurant.special_instructions || '',
            parkingInfo: restaurant.parking_info || '',
            accessibilityNotes: restaurant.accessibility_notes || ''
        });
    }
    const handleSave = async () => {
        try {
            setIsSaving(true);
            setErrorMessage(null);
            setSuccessMessage(null);
            await api.patch(`/restaurants/${user.restaurantId}`, {
                name: formData.name,
                phoneNumber: formData.phoneNumber,
                assistantName: formData.assistantName,
                taxRate: formData.taxRate,
                deliveryFee: formData.deliveryFee,
                // POS integration is handled separately via OAuth - do not save posType/posLocationId here
                addressStreet: formData.addressStreet,
                addressCity: formData.addressCity,
                addressState: formData.addressState,
                addressZip: formData.addressZip,
                businessHours: formData.businessHours,
                managerName: formData.managerName,
                managerPhone: formData.managerPhone,
                supportEmail: formData.supportEmail,
                deliveryRadiusMiles: formData.deliveryRadiusMiles,
                minimumOrderAmount: formData.minimumOrderAmount,
                estimatedPrepTimeMinutes: formData.estimatedPrepTimeMinutes,
                acceptsCash: formData.acceptsCash,
                acceptsCard: formData.acceptsCard,
                specialInstructions: formData.specialInstructions,
                parkingInfo: formData.parkingInfo,
                accessibilityNotes: formData.accessibilityNotes
            });
            queryClient.invalidateQueries({ queryKey: ['restaurant-details', user?.restaurantId] });
            queryClient.invalidateQueries({ queryKey: ['pos-config', user?.restaurantId] });
            setSuccessMessage('✅ Settings saved successfully!');
        }
        catch (error) {
            setErrorMessage(error.response?.data?.message || 'Failed to save settings');
        }
        finally {
            setIsSaving(false);
        }
    };
    const handlePosConnect = async (provider) => {
        try {
            console.log('[POS Connect] Starting OAuth flow', { provider, restaurantId: user?.restaurantId });
            setIsConnectingPos(true);
            setErrorMessage(null);
            if (!user?.restaurantId) {
                console.error('[POS Connect] No restaurant ID found');
                setErrorMessage('Restaurant ID not found. Please log out and log back in.');
                setIsConnectingPos(false);
                return;
            }
            console.log('[POS Connect] Fetching auth URL', { provider, restaurantId: user.restaurantId });
            const { authUrl } = await initiatePosAuth(provider, user.restaurantId);
            console.log('[POS Connect] Auth URL received', { authUrl: authUrl.substring(0, 100) + '...' });
            const width = 600;
            const height = 700;
            const left = window.screen.width / 2 - width / 2;
            const top = window.screen.height / 2 - height / 2;
            console.log('[POS Connect] Opening OAuth popup', { width, height, left, top });
            const authWindow = window.open(authUrl, 'POS OAuth', `width=${width},height=${height},left=${left},top=${top}`);
            if (!authWindow) {
                console.error('[POS Connect] Popup blocked by browser');
                setErrorMessage('Popup was blocked. Please allow popups for this site.');
                setIsConnectingPos(false);
                return;
            }
            console.log('[POS Connect] Popup opened, setting up message listener');
            // Listen for postMessage from the OAuth callback redirect
            const messageHandler = (event) => {
                // Verify origin for security (allow localhost, ngrok, and same origin)
                const isAllowedOrigin = event.origin === window.location.origin ||
                    event.origin.includes('localhost') ||
                    event.origin.includes('127.0.0.1') ||
                    event.origin.includes('ngrok') ||
                    event.origin === '*' || // Accept from any origin for ngrok compatibility
                    !event.origin; // Some browsers may not send origin
                // Log for debugging
                console.log('[POS OAuth] Received message:', {
                    type: event.data?.type,
                    origin: event.origin,
                    isAllowedOrigin,
                    provider: event.data?.provider,
                    hasSession: !!event.data?.session
                });
                if (!isAllowedOrigin) {
                    return;
                }
                if (event.data?.type === 'pos_oauth_complete') {
                    window.removeEventListener('message', messageHandler);
                    if (authWindow) {
                        authWindow.close();
                    }
                    // If session is provided, update URL to trigger location selector
                    if (event.data.session && event.data.provider) {
                        console.log('[POS OAuth] Setting URL params to trigger location selector', {
                            provider: event.data.provider,
                            session: event.data.session
                        });
                        // Update URL params to trigger location selector in useEffect
                        const params = new URLSearchParams(window.location.search);
                        params.set('pos_auth', event.data.provider);
                        params.set('session', event.data.session);
                        // Use replace to avoid adding to history
                        const newUrl = `${window.location.pathname}?${params.toString()}`;
                        window.history.replaceState({}, '', newUrl);
                        // Force React to see the change by updating searchParams
                        setSearchParams(params, { replace: true });
                        // Manually trigger location selector in case useEffect doesn't fire
                        setTimeout(() => {
                            console.log('[POS OAuth] Manually triggering location selector');
                            setPosAuthProvider(event.data.provider);
                            setPosAuthSession(event.data.session);
                            setShowLocationSelector(true);
                            setIsConnectingPos(false);
                            // Fetch locations
                            console.log('[POS OAuth postMessage] Fetching locations manually', {
                                provider: event.data.provider,
                                session: event.data.session
                            });
                            getPosLocations(event.data.provider, event.data.session)
                                .then((result) => {
                                console.log('[POS OAuth postMessage] Locations fetched manually', {
                                    locationCount: result.locations?.length || 0,
                                    merchantCount: result.merchants?.length || 0
                                });
                                if (result.locations && result.locations.length > 0) {
                                    setAvailableLocations(result.locations);
                                    console.log('[POS OAuth postMessage] Set locations:', result.locations.length);
                                }
                                if (result.merchants && result.merchants.length > 0) {
                                    setAvailableMerchants(result.merchants);
                                    console.log('[POS OAuth postMessage] Set merchants:', result.merchants.length);
                                }
                                console.log('[POS OAuth postMessage] Location selector should now be visible');
                            })
                                .catch((err) => {
                                console.error('[POS OAuth postMessage] Failed to fetch locations manually', {
                                    error: err,
                                    message: err.message,
                                    response: err.response?.data
                                });
                                setErrorMessage('Failed to load locations. Please try again.');
                                setShowLocationSelector(false);
                                setIsConnectingPos(false);
                            });
                        }, 100);
                    }
                    else {
                        // Auto-connected (Toast or single location), refresh data
                        queryClient.invalidateQueries({ queryKey: ['pos-config', user?.restaurantId] });
                        queryClient.invalidateQueries({ queryKey: ['restaurant-details', user?.restaurantId] });
                        // Refetch immediately to update UI
                        queryClient.refetchQueries({ queryKey: ['pos-config', user?.restaurantId] });
                        queryClient.refetchQueries({ queryKey: ['restaurant-details', user?.restaurantId] });
                        setSuccessMessage(`${provider.charAt(0).toUpperCase() + provider.slice(1)} connected successfully!`);
                    }
                    setIsConnectingPos(false);
                }
                else if (event.data?.type === 'pos_oauth_error') {
                    window.removeEventListener('message', messageHandler);
                    if (authWindow) {
                        authWindow.close();
                    }
                    setErrorMessage(event.data.error || 'Failed to connect POS system');
                    setIsConnectingPos(false);
                }
            };
            window.addEventListener('message', messageHandler);
            console.log('[POS Connect] Message listener added');
            // Fallback: check if window is closed (user cancelled)
            const checkWindow = setInterval(() => {
                if (authWindow?.closed) {
                    console.log('[POS Connect] Popup closed by user (possible cancellation)');
                    clearInterval(checkWindow);
                    window.removeEventListener('message', messageHandler);
                    setIsConnectingPos(false);
                }
            }, 1000);
            console.log('[POS Connect] Setup complete, waiting for OAuth callback');
        }
        catch (error) {
            setErrorMessage(error.response?.data?.message || 'Failed to connect POS');
            setIsConnectingPos(false);
        }
    };
    const handlePosDisconnect = async () => {
        console.log('🔴 [POS Disconnect] BUTTON CLICKED - Function called!', { restaurantId: user?.restaurantId });
        try {
            setIsSaving(true);
            setErrorMessage(null);
            setSuccessMessage(null);
            console.log('[POS Disconnect] Starting disconnect...', { restaurantId: user?.restaurantId });
            // Call the disconnect endpoint which deletes from restaurant_pos_locations
            const response = await api.delete('/onboarding/pos/disconnect');
            console.log('[POS Disconnect] Success', { response: response.data });
            setFormData((prev) => ({ ...prev, posType: 'none', posLocationId: '' }));
            // Invalidate and refetch queries
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['restaurant-details', user?.restaurantId] }),
                queryClient.invalidateQueries({ queryKey: ['pos-config', user?.restaurantId] }),
                queryClient.refetchQueries({ queryKey: ['restaurant-details', user?.restaurantId] }),
                queryClient.refetchQueries({ queryKey: ['pos-config', user?.restaurantId] })
            ]);
            setSuccessMessage('POS disconnected successfully');
        }
        catch (error) {
            console.error('[POS Disconnect] Error', {
                status: error.response?.status,
                message: error.response?.data?.message || error.message,
                error: error.response?.data,
                restaurantId: user?.restaurantId
            });
            setErrorMessage(error.response?.data?.message || error.response?.data?.error || 'Failed to disconnect POS');
        }
        finally {
            setIsSaving(false);
        }
    };
    const handleFinalizePosConnection = async () => {
        if (!posAuthProvider || !posAuthSession)
            return;
        try {
            setIsFinalizing(true);
            setErrorMessage(null);
            const locationIds = posAuthProvider === 'square' ? selectedLocationIds : undefined;
            const merchantIds = posAuthProvider === 'clover' ? selectedMerchantIds : undefined;
            if (locationIds && locationIds.length === 0 && merchantIds && merchantIds.length === 0) {
                setErrorMessage('Please select at least one location');
                setIsFinalizing(false);
                return;
            }
            const result = await finalizePosConnection(posAuthProvider, posAuthSession, locationIds, merchantIds);
            if (result.success) {
                setSuccessMessage(result.message || 'POS connected successfully!');
                setShowLocationSelector(false);
                setIsConnectingPos(false);
                // Immediately refresh POS config and restaurant data to show updated status
                await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ['pos-config', user?.restaurantId] }),
                    queryClient.invalidateQueries({ queryKey: ['restaurant-details', user?.restaurantId] })
                ]);
                // Refetch immediately to update UI
                await Promise.all([
                    queryClient.refetchQueries({ queryKey: ['pos-config', user?.restaurantId] }),
                    queryClient.refetchQueries({ queryKey: ['restaurant-details', user?.restaurantId] })
                ]);
                // Clean up URL params
                searchParams.delete('pos_auth');
                searchParams.delete('session');
                setSearchParams(searchParams, { replace: true });
                // Reset state
                setPosAuthProvider(null);
                setPosAuthSession(null);
                setAvailableLocations([]);
                setAvailableMerchants([]);
                setSelectedLocationIds([]);
                setSelectedMerchantIds([]);
            }
        }
        catch (error) {
            setErrorMessage(error.response?.data?.message || 'Failed to finalize POS connection');
        }
        finally {
            setIsFinalizing(false);
        }
    };
    const handleCancelLocationSelection = () => {
        setShowLocationSelector(false);
        setPosAuthProvider(null);
        setPosAuthSession(null);
        searchParams.delete('pos_auth');
        searchParams.delete('session');
        setSearchParams(searchParams);
    };
    const syncMutation = useMutation({
        mutationFn: () => triggerMenuSync(user.restaurantId),
        onSuccess: (result) => {
            setSuccessMessage(`✅ Synced ${result.synced} items from ${result.provider}`);
            queryClient.invalidateQueries({ queryKey: ['restaurant-menu', user?.restaurantId] });
        },
        onError: (error) => {
            setErrorMessage(error.response?.data?.message || 'Sync failed');
        }
    });
    const updateBusinessHours = (day, field, value) => {
        setFormData((prev) => ({
            ...prev,
            businessHours: {
                ...prev.businessHours,
                [day]: {
                    ...prev.businessHours[day],
                    [field]: value
                }
            }
        }));
    };
    if (isLoading) {
        return (_jsx("div", { className: "space-y-8 text-white", children: _jsx("div", { className: "glass-panel p-10 text-center text-white/60", children: "Loading settings\u2026" }) }));
    }
    return (_jsxs("div", { className: "space-y-8 text-white", children: [_jsxs("header", { children: [_jsx("p", { className: "text-sm uppercase tracking-[0.3rem] text-white/50", children: "Configuration" }), _jsx("h1", { className: "text-4xl font-bold", children: "Restaurant Settings" }), _jsx("p", { className: "text-white/60 mt-2", children: "Configure information that your AI assistant uses to answer customer questions" })] }), successMessage && (_jsx("div", { className: "bg-emerald-500/20 border border-emerald-500/30 rounded-xl p-4", children: _jsx("p", { className: "text-sm text-emerald-300", children: successMessage }) })), errorMessage && (_jsx("div", { className: "bg-rose-500/20 border border-rose-500/30 rounded-xl p-4", children: _jsx("p", { className: "text-sm text-rose-300", children: errorMessage }) })), _jsxs("div", { className: "glass-panel p-8 space-y-6", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(Building2, { className: "h-6 w-6 text-white/70" }), _jsx("h2", { className: "text-2xl font-bold", children: "Basic Information" })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-6", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-white/70 mb-2", children: "Restaurant Name *" }), _jsx("input", { type: "text", value: formData.name, onChange: (e) => setFormData((prev) => ({ ...prev, name: e.target.value })), className: "w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-white/70 mb-2", children: "Phone Number" }), _jsx("input", { type: "tel", value: formData.phoneNumber, onChange: (e) => setFormData((prev) => ({ ...prev, phoneNumber: e.target.value })), className: "w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30", placeholder: "+1 (555) 123-4567" })] }), _jsxs("div", { children: [_jsxs("label", { className: "block text-sm font-medium text-white/70 mb-2", children: ["Assistant Name", _jsx("span", { className: "text-xs text-white/50 ml-2", children: "(for personalized greetings)" })] }), _jsx("input", { type: "text", value: formData.assistantName, onChange: (e) => setFormData((prev) => ({ ...prev, assistantName: e.target.value })), className: "w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30", placeholder: "e.g., Sarah, Alex, or leave empty" }), _jsx("p", { className: "text-xs text-white/50 mt-1", children: "The AI will introduce itself with this name in call greetings" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-white/70 mb-2", children: "Tax Rate (%)" }), _jsx("input", { type: "number", step: "0.01", value: formData.taxRate * 100, onChange: (e) => setFormData((prev) => ({ ...prev, taxRate: parseFloat(e.target.value) / 100 })), className: "w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-white/70 mb-2", children: "Delivery Fee ($)" }), _jsx("input", { type: "number", step: "0.01", value: formData.deliveryFee, onChange: (e) => setFormData((prev) => ({ ...prev, deliveryFee: parseFloat(e.target.value) })), className: "w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30" })] })] })] }), _jsxs("div", { className: "glass-panel p-8 space-y-6", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(MapPin, { className: "h-6 w-6 text-white/70" }), _jsx("h2", { className: "text-2xl font-bold", children: "Location & Address" })] }), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-white/70 mb-2", children: "Street Address" }), _jsx("input", { type: "text", value: formData.addressStreet, onChange: (e) => setFormData((prev) => ({ ...prev, addressStreet: e.target.value })), className: "w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30", placeholder: "123 Main Street" })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-3 gap-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-white/70 mb-2", children: "City" }), _jsx("input", { type: "text", value: formData.addressCity, onChange: (e) => setFormData((prev) => ({ ...prev, addressCity: e.target.value })), className: "w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-white/70 mb-2", children: "State" }), _jsx("input", { type: "text", value: formData.addressState, onChange: (e) => setFormData((prev) => ({ ...prev, addressState: e.target.value })), className: "w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-white/70 mb-2", children: "ZIP Code" }), _jsx("input", { type: "text", value: formData.addressZip, onChange: (e) => setFormData((prev) => ({ ...prev, addressZip: e.target.value })), className: "w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-white/70 mb-2", children: "Parking Information" }), _jsx("textarea", { value: formData.parkingInfo, onChange: (e) => setFormData((prev) => ({ ...prev, parkingInfo: e.target.value })), className: "w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30", rows: 2, placeholder: "e.g., Free parking in front, Street parking available" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-white/70 mb-2", children: "Accessibility Notes" }), _jsx("textarea", { value: formData.accessibilityNotes, onChange: (e) => setFormData((prev) => ({ ...prev, accessibilityNotes: e.target.value })), className: "w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30", rows: 2, placeholder: "e.g., Wheelchair accessible entrance, Elevator available" })] })] })] }), _jsxs("div", { className: "glass-panel p-8 space-y-6", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(Clock, { className: "h-6 w-6 text-white/70" }), _jsx("h2", { className: "text-2xl font-bold", children: "Business Hours" })] }), _jsx("div", { className: "space-y-3", children: DAYS_OF_WEEK.map((day) => {
                            const hours = formData.businessHours[day] || { open: '09:00', close: '21:00', closed: false };
                            return (_jsxs("div", { className: "flex items-center gap-4", children: [_jsx("div", { className: "w-32", children: _jsx("span", { className: "text-white font-medium capitalize", children: day }) }), _jsxs("label", { className: "flex items-center gap-2", children: [_jsx("input", { type: "checkbox", checked: hours.closed, onChange: (e) => updateBusinessHours(day, 'closed', e.target.checked), className: "rounded" }), _jsx("span", { className: "text-sm text-white/70", children: "Closed" })] }), !hours.closed && (_jsxs(_Fragment, { children: [_jsx("input", { type: "time", value: hours.open, onChange: (e) => updateBusinessHours(day, 'open', e.target.value), className: "px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-white/30" }), _jsx("span", { className: "text-white/50", children: "to" }), _jsx("input", { type: "time", value: hours.close, onChange: (e) => updateBusinessHours(day, 'close', e.target.value), className: "px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-white/30" })] }))] }, day));
                        }) })] }), _jsxs("div", { className: "glass-panel p-8 space-y-6", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(Users, { className: "h-6 w-6 text-white/70" }), _jsx("h2", { className: "text-2xl font-bold", children: "Contact & Support" })] }), _jsx("div", { className: "bg-white/5 border border-white/10 rounded-xl p-4 mb-4", children: _jsx("p", { className: "text-sm text-white/70", children: "These contacts will be provided to customers when the AI assistant cannot resolve their query" }) }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-6", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-white/70 mb-2", children: "Manager Name" }), _jsx("input", { type: "text", value: formData.managerName, onChange: (e) => setFormData((prev) => ({ ...prev, managerName: e.target.value })), className: "w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30", placeholder: "John Smith" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-white/70 mb-2", children: "Manager Phone" }), _jsx("input", { type: "tel", value: formData.managerPhone, onChange: (e) => setFormData((prev) => ({ ...prev, managerPhone: e.target.value })), className: "w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30", placeholder: "+1 (555) 987-6543" })] }), _jsxs("div", { className: "md:col-span-2", children: [_jsx("label", { className: "block text-sm font-medium text-white/70 mb-2", children: "Support Email" }), _jsx("input", { type: "email", value: formData.supportEmail, onChange: (e) => setFormData((prev) => ({ ...prev, supportEmail: e.target.value })), className: "w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30", placeholder: "support@restaurant.com" })] })] })] }), _jsxs("div", { className: "glass-panel p-8 space-y-6", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(Truck, { className: "h-6 w-6 text-white/70" }), _jsx("h2", { className: "text-2xl font-bold", children: "Delivery & Ordering" })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-3 gap-6", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-white/70 mb-2", children: "Delivery Radius (miles)" }), _jsx("input", { type: "number", step: "0.5", value: formData.deliveryRadiusMiles, onChange: (e) => setFormData((prev) => ({
                                            ...prev,
                                            deliveryRadiusMiles: parseFloat(e.target.value)
                                        })), className: "w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-white/70 mb-2", children: "Minimum Order ($)" }), _jsx("input", { type: "number", step: "0.01", value: formData.minimumOrderAmount, onChange: (e) => setFormData((prev) => ({
                                            ...prev,
                                            minimumOrderAmount: parseFloat(e.target.value)
                                        })), className: "w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-white/70 mb-2", children: "Prep Time (minutes)" }), _jsx("input", { type: "number", value: formData.estimatedPrepTimeMinutes, onChange: (e) => setFormData((prev) => ({
                                            ...prev,
                                            estimatedPrepTimeMinutes: parseInt(e.target.value)
                                        })), className: "w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30" })] })] }), _jsxs("div", { className: "flex items-center gap-6", children: [_jsxs("label", { className: "flex items-center gap-2", children: [_jsx("input", { type: "checkbox", checked: formData.acceptsCash, onChange: (e) => setFormData((prev) => ({ ...prev, acceptsCash: e.target.checked })), className: "rounded" }), _jsx("span", { className: "text-white", children: "Accepts Cash" })] }), _jsxs("label", { className: "flex items-center gap-2", children: [_jsx("input", { type: "checkbox", checked: formData.acceptsCard, onChange: (e) => setFormData((prev) => ({ ...prev, acceptsCard: e.target.checked })), className: "rounded" }), _jsx("span", { className: "text-white", children: "Accepts Card" })] })] })] }), _jsxs("div", { className: "glass-panel p-8 space-y-6", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(FileText, { className: "h-6 w-6 text-white/70" }), _jsx("h2", { className: "text-2xl font-bold", children: "Special Instructions for AI Assistant" })] }), _jsx("div", { className: "bg-white/5 border border-white/10 rounded-xl p-4", children: _jsx("p", { className: "text-sm text-white/70", children: "Provide any special instructions or information that the AI should communicate to customers (e.g., special offers, dietary accommodations, ordering policies)" }) }), _jsx("textarea", { value: formData.specialInstructions, onChange: (e) => setFormData((prev) => ({ ...prev, specialInstructions: e.target.value })), className: "w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30", rows: 6, placeholder: "e.g., We offer gluten-free options. Mention our lunch special from 11am-2pm. For large orders (10+ items), please call the manager directly." })] }), _jsxs("div", { className: "glass-panel p-8 space-y-6", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-2xl font-bold text-white mb-2", children: "POS Integration" }), _jsx("p", { className: "text-white/60 text-sm", children: "Connect your POS system to automatically sync menu items and push orders" })] }), posConfig && posConfig.posType !== 'none' && (_jsxs("div", { className: "flex items-center gap-2 px-4 py-2 bg-emerald-500/20 border border-emerald-500/30 rounded-full", children: [_jsx(CheckCircle2, { className: "h-4 w-4 text-emerald-400" }), _jsx("span", { className: "text-sm text-emerald-300", children: "Connected" })] }))] }), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-white/70 mb-3", children: "Current POS System" }), _jsx("div", { className: "grid grid-cols-2 md:grid-cols-4 gap-3", children: [
                                            { value: 'square', label: 'Square' },
                                            { value: 'toast', label: 'Toast' },
                                            { value: 'clover', label: 'Clover' },
                                            { value: 'none', label: 'None (Manual)' }
                                        ].map((pos) => (_jsx("button", { type: "button", onClick: () => setFormData((prev) => ({ ...prev, posType: pos.value })), className: `px-6 py-4 rounded-xl border-2 font-medium transition-all ${formData.posType === pos.value
                                                ? 'bg-white text-slate-900 border-white shadow-lg'
                                                : 'bg-white/10 text-white border-white/20 hover:bg-white/20'}`, children: pos.label }, pos.value))) })] }), formData.posType !== 'none' ? (_jsxs(_Fragment, { children: [posConfig && posConfig.lastSyncAt && (_jsx("div", { className: "bg-white/5 border border-white/10 rounded-xl p-4", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm font-medium text-white/70", children: "Last Menu Sync" }), _jsx("p", { className: "text-sm text-white/50 mt-1", children: new Date(posConfig.lastSyncAt).toLocaleString() })] }), _jsxs("button", { type: "button", onClick: () => syncMutation.mutate(), disabled: syncMutation.isPending, className: "flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/20 rounded-xl text-sm text-white hover:bg-white/20 transition-all disabled:opacity-50", children: [_jsx(RefreshCw, { className: "h-4 w-4" }), "Sync Now"] })] }) })), _jsxs("div", { className: "flex items-center gap-3", children: [_jsxs("button", { type: "button", onClick: () => handlePosConnect(formData.posType), disabled: isConnectingPos, className: "flex items-center gap-2 px-6 py-3 bg-white text-slate-900 rounded-xl font-semibold hover:bg-white/90 transition-all disabled:opacity-50", children: [_jsx(Link2, { className: "h-4 w-4" }), isConnectingPos
                                                        ? 'Connecting...'
                                                        : posConfig && posConfig.posType !== 'none'
                                                            ? 'Reauthorize Connection'
                                                            : 'Connect POS'] }), (() => {
                                                const shouldShow = (posConfig && posConfig.posType !== 'none') || (restaurant && restaurant.pos_type && restaurant.pos_type !== 'none');
                                                console.log('🔍 [DISCONNECT BUTTON] Render check:', {
                                                    shouldShow,
                                                    posConfigType: posConfig?.posType,
                                                    restaurantType: restaurant?.pos_type,
                                                    isSaving,
                                                    timestamp: new Date().toISOString()
                                                });
                                                if (!shouldShow)
                                                    return null;
                                                return (_jsxs("button", { type: "button", onClick: (e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        console.error('🔴🔴🔴 [DISCONNECT] CLICK EVENT FIRED!', {
                                                            posConfig,
                                                            restaurantPosType: restaurant?.pos_type,
                                                            timestamp: new Date().toISOString()
                                                        });
                                                        alert('DISCONNECT BUTTON CLICKED!'); // VERY VISIBLE
                                                        handlePosDisconnect();
                                                    }, disabled: isSaving, className: "flex items-center gap-2 px-6 py-3 bg-rose-500/20 border border-rose-500/30 text-rose-300 rounded-xl font-semibold hover:bg-rose-500/30 transition-all disabled:opacity-50", children: [_jsx(Unlink, { className: "h-4 w-4" }), "Disconnect"] }));
                                            })()] })] })) : (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "bg-white/5 border border-white/10 rounded-xl p-4", children: [_jsx("h4", { className: "text-sm font-semibold text-white mb-2", children: "Manual Menu Management" }), _jsx("p", { className: "text-sm text-white/70 mb-4", children: "Without POS integration, you can manage your menu directly. Orders will be sent to you via SMS." }), _jsxs("ul", { className: "space-y-2 text-sm text-white/70", children: [_jsxs("li", { className: "flex items-start gap-2", children: [_jsx(CheckCircle2, { className: "h-4 w-4 text-emerald-400 mt-0.5 flex-shrink-0" }), _jsx("span", { children: "Add/edit menu items in the Menu page" })] }), _jsxs("li", { className: "flex items-start gap-2", children: [_jsx(CheckCircle2, { className: "h-4 w-4 text-emerald-400 mt-0.5 flex-shrink-0" }), _jsx("span", { children: "New orders will be sent to your manager phone via SMS" })] }), _jsxs("li", { className: "flex items-start gap-2", children: [_jsx(CheckCircle2, { className: "h-4 w-4 text-emerald-400 mt-0.5 flex-shrink-0" }), _jsx("span", { children: "Update order status manually in the Orders page" })] })] })] }), _jsx("div", { className: "flex items-center gap-3", children: _jsxs("button", { type: "button", onClick: () => window.location.href = '/restaurant/menu', className: "flex items-center gap-2 px-6 py-3 bg-white text-slate-900 rounded-xl font-semibold hover:bg-white/90 transition-all", children: [_jsx(FileText, { className: "h-4 w-4" }), "Manage Menu Items"] }) })] }))] })] }), _jsx("div", { className: "flex items-center justify-end gap-3 pt-6 border-t border-white/10", children: _jsxs("button", { type: "button", onClick: handleSave, disabled: isSaving, className: "flex items-center gap-2 px-8 py-4 bg-white text-slate-900 rounded-xl font-semibold hover:bg-white/90 transition-all disabled:opacity-50 shadow-lg", children: [_jsx(Save, { className: "h-5 w-5" }), isSaving ? 'Saving...' : 'Save All Settings'] }) }), showLocationSelector && (_jsx("div", { className: "fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4", children: _jsxs("div", { className: "glass-panel p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto", children: [_jsxs("div", { className: "flex items-center justify-between mb-6", children: [_jsxs("div", { children: [_jsxs("h2", { className: "text-2xl font-bold text-white mb-2", children: ["Select ", posAuthProvider === 'square' ? 'Locations' : 'Merchants'] }), _jsxs("p", { className: "text-white/60 text-sm", children: ["Choose which ", posAuthProvider === 'square' ? 'locations' : 'merchants', " you want to connect to your restaurant"] })] }), _jsx("button", { onClick: handleCancelLocationSelection, className: "text-white/60 hover:text-white transition-colors", children: _jsx(X, { className: "h-5 w-5" }) })] }), errorMessage && (_jsx("div", { className: "bg-rose-500/20 border border-rose-500/30 rounded-xl p-4 mb-4", children: _jsx("p", { className: "text-sm text-rose-300", children: errorMessage }) })), _jsxs("div", { className: "space-y-3 mb-6", children: [posAuthProvider === 'square' && availableLocations.map((location) => {
                                    const isSelected = selectedLocationIds.includes(location.id);
                                    return (_jsxs("label", { className: `flex items-start gap-3 p-4 border rounded-xl cursor-pointer transition-all ${isSelected
                                            ? 'bg-white/10 border-white/30'
                                            : 'bg-white/5 border-white/10 hover:bg-white/10'}`, children: [_jsx("input", { type: "checkbox", checked: isSelected, onChange: (e) => {
                                                    if (e.target.checked) {
                                                        setSelectedLocationIds([...selectedLocationIds, location.id]);
                                                    }
                                                    else {
                                                        setSelectedLocationIds(selectedLocationIds.filter((id) => id !== location.id));
                                                    }
                                                }, className: "mt-1 h-4 w-4 text-white border-white/30 rounded focus:ring-2 focus:ring-white/50" }), _jsxs("div", { className: "flex-1", children: [_jsx("div", { className: "font-semibold text-white", children: location.name }), location.address && (_jsx("div", { className: "text-sm text-white/60 mt-1", children: location.address.address_line_1 })), location.capabilities && location.capabilities.length > 0 && (_jsxs("div", { className: "text-xs text-white/50 mt-1", children: ["Capabilities: ", location.capabilities.join(', ')] }))] })] }, location.id));
                                }), posAuthProvider === 'clover' && availableMerchants.map((merchant) => {
                                    const isSelected = selectedMerchantIds.includes(merchant.id);
                                    return (_jsxs("label", { className: `flex items-start gap-3 p-4 border rounded-xl cursor-pointer transition-all ${isSelected
                                            ? 'bg-white/10 border-white/30'
                                            : 'bg-white/5 border-white/10 hover:bg-white/10'}`, children: [_jsx("input", { type: "checkbox", checked: isSelected, onChange: (e) => {
                                                    if (e.target.checked) {
                                                        setSelectedMerchantIds([...selectedMerchantIds, merchant.id]);
                                                    }
                                                    else {
                                                        setSelectedMerchantIds(selectedMerchantIds.filter((id) => id !== merchant.id));
                                                    }
                                                }, className: "mt-1 h-4 w-4 text-white border-white/30 rounded focus:ring-2 focus:ring-white/50" }), _jsxs("div", { className: "flex-1", children: [_jsx("div", { className: "font-semibold text-white", children: merchant.name }), merchant.address && (_jsxs("div", { className: "text-sm text-white/60 mt-1", children: [merchant.address.address1, ", ", merchant.address.city, ", ", merchant.address.state] }))] })] }, merchant.id));
                                }), (posAuthProvider === 'square' && availableLocations.length === 0) ||
                                    (posAuthProvider === 'clover' && availableMerchants.length === 0) ? (_jsxs("div", { className: "text-center py-8 text-white/60", children: ["No ", posAuthProvider === 'square' ? 'locations' : 'merchants', " available"] })) : null] }), _jsxs("div", { className: "flex items-center justify-end gap-3 pt-4 border-t border-white/10", children: [_jsx("button", { type: "button", onClick: handleCancelLocationSelection, className: "px-6 py-3 bg-white/10 border border-white/20 rounded-xl text-white hover:bg-white/20 transition-all", children: "Cancel" }), _jsx("button", { type: "button", onClick: handleFinalizePosConnection, disabled: isFinalizing || (posAuthProvider === 'square' && selectedLocationIds.length === 0) || (posAuthProvider === 'clover' && selectedMerchantIds.length === 0), className: "px-6 py-3 bg-white text-slate-900 rounded-xl font-semibold hover:bg-white/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed", children: isFinalizing ? 'Connecting...' : `Connect ${selectedLocationIds.length + selectedMerchantIds.length} ${posAuthProvider === 'square' ? 'Location(s)' : 'Merchant(s)'}` })] })] }) }))] }));
}
