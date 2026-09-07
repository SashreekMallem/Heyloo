import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link } from 'react-router-dom';
import { useEffect, useRef, useState, useCallback } from 'react';
import { ArrowRight, Phone, Shield, CheckCircle2, Star, Users, BarChart3, Clock, Headphones, Building2, TrendingUp, Sparkles, Play, Award, PhoneCall, CreditCard, Utensils, Wifi, Battery, Signal, Activity, DollarSign, ShoppingCart } from 'lucide-react';
export function LandingPage() {
    const [scrollY, setScrollY] = useState(0);
    const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
    const [deviceState, setDeviceState] = useState('phone'); // phone | pos | analytics
    const [isInteracting, setIsInteracting] = useState(false);
    const [voiceLevel, setVoiceLevel] = useState(0);
    const [orderData, setOrderData] = useState({
        total: 47.85,
        items: 3,
        status: 'processing'
    });
    const deviceRef = useRef(null);
    const sceneRef = useRef(null);
    // Advanced mouse tracking with momentum
    useEffect(() => {
        let momentum = { x: 0, y: 0 };
        const handleMouseMove = (e) => {
            const rect = window.innerWidth;
            const x = ((e.clientX / rect) - 0.5) * 2;
            const y = ((e.clientY / window.innerHeight) - 0.5) * 2;
            momentum.x = (x - mousePosition.x) * 0.1;
            momentum.y = (y - mousePosition.y) * 0.1;
            setMousePosition({ x, y });
            setIsInteracting(true);
            setTimeout(() => setIsInteracting(false), 150);
        };
        window.addEventListener('mousemove', handleMouseMove);
        return () => window.removeEventListener('mousemove', handleMouseMove);
    }, [mousePosition]);
    // Device state cycling (like real Apple website)
    useEffect(() => {
        const states = ['phone', 'pos', 'analytics'];
        let currentIndex = 0;
        const interval = setInterval(() => {
            currentIndex = (currentIndex + 1) % states.length;
            setDeviceState(states[currentIndex]);
        }, 5000);
        return () => clearInterval(interval);
    }, []);
    // Voice simulation
    useEffect(() => {
        const interval = setInterval(() => {
            if (deviceState === 'phone') {
                setVoiceLevel(Math.sin(Date.now() / 200) * 0.5 + 0.5);
            }
        }, 50);
        return () => clearInterval(interval);
    }, [deviceState]);
    // Real-time order updates
    useEffect(() => {
        const interval = setInterval(() => {
            if (deviceState === 'analytics') {
                setOrderData(prev => ({
                    ...prev,
                    total: prev.total + (Math.random() - 0.5) * 10,
                    items: prev.items + (Math.random() > 0.7 ? 1 : 0)
                }));
            }
        }, 2000);
        return () => clearInterval(interval);
    }, [deviceState]);
    // Scroll tracking
    useEffect(() => {
        const handleScroll = () => setScrollY(window.scrollY);
        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);
    // Advanced 3D transforms (Apple-style)
    const get3DTransform = useCallback((intensity = 1, type = 'card') => {
        const rotateX = -mousePosition.y * (25 * intensity);
        const rotateY = mousePosition.x * (25 * intensity);
        const scale = isInteracting ? 1.02 : 1;
        const translateZ = type === 'device' ? (isInteracting ? 50 : 0) : 0;
        return {
            transform: `
        perspective(2000px) 
        rotateX(${rotateX}deg) 
        rotateY(${rotateY}deg) 
        scale(${scale})
        translateZ(${translateZ}px)
      `,
            transition: isInteracting ? 'transform 0.1s cubic-bezier(0.4, 0, 0.2, 1)' : 'transform 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
            transformStyle: 'preserve-3d'
        };
    }, [mousePosition, isInteracting]);
    // Device morphing animation
    const getDeviceMorphTransform = useCallback(() => {
        const transforms = {
            phone: 'rotateX(0deg) rotateY(0deg) scale(1)',
            pos: 'rotateX(-15deg) rotateY(25deg) scale(1.1)',
            analytics: 'rotateX(10deg) rotateY(-20deg) scale(1.15)'
        };
        return {
            transform: transforms[deviceState],
            transition: 'transform 1.2s cubic-bezier(0.4, 0, 0.2, 1)'
        };
    }, [deviceState]);
    return (_jsxs("div", { className: "relative min-h-screen bg-black text-white overflow-hidden", children: [_jsxs("div", { className: "fixed inset-0 -z-10", ref: sceneRef, children: [_jsx("div", { className: "absolute inset-0", style: {
                            background: `
              radial-gradient(circle at ${50 + mousePosition.x * 20}% ${50 + mousePosition.y * 20}%, 
                rgba(59, 130, 246, ${0.15 + Math.sin(Date.now() / 3000) * 0.05}) 0%, 
                transparent 40%),
              radial-gradient(circle at ${80 + mousePosition.x * -15}% ${30 + mousePosition.y * -10}%, 
                rgba(147, 51, 234, ${0.12 + Math.cos(Date.now() / 4000) * 0.03}) 0%, 
                transparent 50%),
              linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%)
            `
                        } }), _jsx("div", { className: "absolute inset-0 overflow-hidden", children: [...Array(100)].map((_, i) => (_jsx("div", { className: "absolute w-1 h-1 bg-white/30 rounded-full", style: {
                                top: `${Math.random() * 100}%`,
                                left: `${Math.random() * 100}%`,
                                transform: `
                  translate3d(
                    ${Math.sin(Date.now() / (5000 + i * 100)) * 100}px,
                    ${Math.cos(Date.now() / (6000 + i * 120)) * 80}px,
                    ${Math.sin(Date.now() / (4000 + i * 80)) * 50}px
                  ) 
                  scale(${0.5 + Math.sin(Date.now() / (3000 + i * 50)) * 0.3})
                `,
                                opacity: 0.1 + Math.sin(Date.now() / (2000 + i * 30)) * 0.2,
                                filter: `blur(${Math.sin(Date.now() / (1000 + i * 40)) * 2}px)`
                            } }, i))) }), [...Array(5)].map((_, i) => (_jsx("div", { className: "absolute inset-0 opacity-10", style: {
                            background: `radial-gradient(circle, rgba(59, 130, 246, 0.1) 0%, transparent 70%)`,
                            transform: `
                translateX(${mousePosition.x * (10 + i * 5)}px) 
                translateY(${mousePosition.y * (5 + i * 3)}px) 
                scale(${1 + i * 0.1})
                translateZ(${i * 20}px)
              `,
                            filter: `blur(${i * 2}px)`
                        } }, i)))] }), _jsx("nav", { className: "relative z-50 backdrop-blur-2xl bg-black/30 border-b border-white/10", style: {
                    ...get3DTransform(0.3),
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
                }, children: _jsx("div", { className: "max-w-7xl mx-auto px-6 py-6", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-4", children: [_jsx("div", { className: "relative group cursor-pointer", style: get3DTransform(1.2), children: _jsxs("div", { className: "relative w-14 h-14 transform-gpu", children: [[...Array(4)].map((_, i) => (_jsx("div", { className: "absolute inset-0 rounded-2xl", style: {
                                                        background: `linear-gradient(135deg, 
                          hsl(${220 + i * 5}, 100%, ${60 + i * 5}%), 
                          hsl(${250 + i * 5}, 100%, ${50 + i * 5}%))`,
                                                        transform: `translateZ(${-i * 2}px) scale(${1 + i * 0.02})`,
                                                        opacity: 0.8 - i * 0.15
                                                    } }, i))), _jsxs("div", { className: "relative w-full h-full bg-gradient-to-br from-blue-500 via-indigo-600 to-purple-700 rounded-2xl flex items-center justify-center overflow-hidden", children: [_jsx(Headphones, { className: "h-7 w-7 text-white relative z-10", style: {
                                                                filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))',
                                                                transform: `rotateY(${mousePosition.x * 8}deg) rotateX(${mousePosition.y * 5}deg)`
                                                            } }), _jsx("div", { className: "absolute inset-0 bg-gradient-to-br from-white/40 via-transparent to-black/20 rounded-2xl pointer-events-none", style: {
                                                                transform: `translate(${mousePosition.x * 3}px, ${mousePosition.y * 3}px)`
                                                            } }), _jsx("div", { className: "absolute inset-2 border border-white/20 rounded-xl opacity-30", style: {
                                                                transform: `rotate(${Date.now() / 5000 % 360}deg)`
                                                            } })] }), _jsx("div", { className: "absolute -top-2 -right-2 w-5 h-5 rounded-full border-3 border-black overflow-hidden", style: {
                                                        background: 'linear-gradient(135deg, #10b981, #059669)',
                                                        boxShadow: `
                        0 0 20px rgba(16, 185, 129, 0.6),
                        inset 0 2px 4px rgba(255,255,255,0.3),
                        inset 0 -2px 4px rgba(0,0,0,0.3)
                      `,
                                                        transform: `scale(${1 + Math.sin(Date.now() / 1000) * 0.1}) translateZ(10px)`
                                                    }, children: _jsx("div", { className: "absolute inset-1 bg-white rounded-full opacity-50 animate-pulse" }) })] }) }), _jsxs("div", { children: [_jsx("span", { className: "text-3xl font-black bg-gradient-to-r from-white via-blue-100 to-white bg-clip-text text-transparent", style: {
                                                    transform: `translateY(${mousePosition.y * 3}px)`,
                                                    filter: 'drop-shadow(0 2px 4px rgba(255,255,255,0.1))'
                                                }, children: "Heyloo" }), _jsx("div", { className: "text-xs text-gray-400 font-mono tracking-[0.15em] uppercase", children: "Neural Restaurant OS" })] })] }), _jsxs("div", { className: "hidden md:flex items-center gap-8", children: [_jsxs(Link, { to: "/support", className: "text-sm font-medium text-gray-400 hover:text-white transition-all duration-300 relative group", style: get3DTransform(0.4), children: ["Support", _jsx("div", { className: "absolute bottom-0 left-0 w-0 h-0.5 bg-gradient-to-r from-blue-400 to-purple-500 group-hover:w-full transition-all duration-500" })] }), _jsxs(Link, { to: "/login", className: "text-sm px-8 py-3 rounded-xl border border-white/20 text-gray-300 hover:text-white hover:bg-white/10 hover:border-white/40 transition-all duration-300 font-medium backdrop-blur-xl relative overflow-hidden", style: get3DTransform(0.5), children: [_jsx("div", { className: "absolute inset-0 bg-gradient-to-r from-blue-500/5 to-purple-500/5 translate-y-full group-hover:translate-y-0 transition-transform duration-500" }), _jsx("span", { className: "relative", children: "Sign In" })] }), _jsxs(Link, { to: "/onboarding", className: "group relative text-sm px-10 py-4 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white font-bold hover:from-blue-500 hover:via-indigo-500 hover:to-purple-500 transition-all duration-500 flex items-center gap-3 shadow-2xl overflow-hidden", style: {
                                            ...get3DTransform(0.8),
                                            boxShadow: `
                    0 20px 40px rgba(59, 130, 246, 0.3),
                    inset 0 1px 0 rgba(255, 255, 255, 0.1)
                  `
                                        }, children: [_jsx("div", { className: "absolute inset-0 bg-gradient-to-r from-white/20 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" }), _jsx("div", { className: "absolute inset-0 bg-gradient-to-45deg from-cyan-500/10 to-pink-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" }), _jsx(PhoneCall, { className: "h-5 w-5 relative z-10" }), _jsx("span", { className: "relative z-10", children: "Get Started" }), _jsx(ArrowRight, { className: "h-5 w-5 group-hover:translate-x-1 transition-transform relative z-10" })] })] })] }) }) }), _jsx("section", { className: "relative pt-20 pb-40 px-6", children: _jsx("div", { className: "max-w-7xl mx-auto", children: _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-20 items-center", children: [_jsxs("div", { className: "space-y-12 max-w-3xl", children: [_jsxs("div", { className: "inline-flex items-center gap-4 px-8 py-4 rounded-2xl bg-gradient-to-r from-white/10 via-white/15 to-white/10 border border-white/20 backdrop-blur-2xl hover:bg-white/20 transition-all duration-700 cursor-pointer group overflow-hidden", style: get3DTransform(0.6), children: [_jsx("div", { className: "absolute inset-0 bg-gradient-to-r from-blue-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" }), _jsx("div", { className: "w-4 h-4 rounded-full relative overflow-hidden", style: {
                                                    background: 'linear-gradient(135deg, #10b981, #059669)',
                                                    boxShadow: `0 0 20px rgba(16, 185, 129, ${0.6 + Math.sin(Date.now() / 800) * 0.3})`,
                                                    transform: `scale(${1 + Math.sin(Date.now() / 600) * 0.2})`
                                                }, children: _jsx("div", { className: "absolute inset-1 bg-white rounded-full animate-pulse" }) }), _jsx("span", { className: "text-sm font-mono text-green-400 tracking-wider uppercase relative z-10", children: "Neural AI Online" }), _jsx("div", { className: "w-px h-6 bg-white/30" }), _jsx(Sparkles, { className: "h-5 w-5 text-blue-400" }), _jsx("span", { className: "text-sm font-semibold text-white relative z-10", children: "Processing Restaurant Orders" }), _jsx(Activity, { className: "h-5 w-5 text-purple-400" })] }), _jsxs("div", { className: "space-y-10", children: [_jsxs("h1", { className: "text-7xl md:text-8xl lg:text-9xl font-black leading-[0.75] tracking-tighter", style: {
                                                    textShadow: '0 0 100px rgba(59, 130, 246, 0.3)'
                                                }, children: [['Never', 'Miss', 'Another'].map((word, index) => (_jsx("span", { className: "block text-white transition-all duration-1000", style: {
                                                            transform: `
                          perspective(1000px)
                          translateX(${mousePosition.x * (12 - index * 3)}px) 
                          translateY(${mousePosition.y * (8 - index * 2)}px)
                          rotateX(${mousePosition.y * 5}deg)
                          rotateY(${mousePosition.x * (index + 1) * 3}deg)
                          translateZ(${index * 20}px)
                        `,
                                                            textShadow: `
                          ${mousePosition.x * (index + 1) * 3}px ${mousePosition.y * (index + 1) * 3}px 50px rgba(59, 130, 246, 0.4),
                          ${mousePosition.x * -2}px ${mousePosition.y * -2}px 30px rgba(147, 51, 234, 0.3)
                        `,
                                                            filter: `drop-shadow(0 ${20 + index * 10}px ${40 + index * 20}px rgba(59, 130, 246, 0.2))`,
                                                            transitionDelay: `${index * 150}ms`
                                                        }, children: word }, word))), _jsxs("span", { className: "block bg-gradient-to-r from-blue-400 via-purple-400 via-pink-400 to-orange-400 bg-clip-text text-transparent relative transition-all duration-1000", style: {
                                                            transform: `
                        perspective(1000px)
                        translateX(${mousePosition.x * 15}px) 
                        translateY(${mousePosition.y * -8}px)
                        rotateZ(${mousePosition.x * 4}deg)
                        translateZ(60px)
                      `,
                                                            filter: 'drop-shadow(0 30px 60px rgba(147, 51, 234, 0.4))'
                                                        }, children: ["Order", _jsx("div", { className: "absolute -bottom-6 left-1/2 transform -translate-x-1/2 h-3 rounded-full", style: {
                                                                    width: '400px',
                                                                    background: 'linear-gradient(90deg, #3b82f6, #8b5cf6, #ec4899, #f97316)',
                                                                    boxShadow: `
                          0 0 50px rgba(59, 130, 246, 0.8),
                          0 0 100px rgba(147, 51, 234, 0.6),
                          0 0 150px rgba(236, 72, 153, 0.4)
                        `
                                                                } })] })] }), _jsxs("p", { className: "text-2xl md:text-3xl text-gray-300 leading-relaxed font-light max-w-3xl", style: {
                                                    transform: `
                      translateY(${scrollY * 0.1}px) 
                      translateZ(30px)
                    `,
                                                    textShadow: '0 10px 30px rgba(0,0,0,0.5)'
                                                }, children: ["Revolutionary AI that transforms every customer interaction into profit.", _jsx("span", { className: "font-semibold text-white bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent", children: "Smart. Instant. Unstoppable." })] })] }), _jsxs("div", { className: "flex flex-col sm:flex-row items-start gap-8 pt-12", children: [_jsxs(Link, { to: "/onboarding", className: "group relative px-16 py-6 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 via-purple-600 to-pink-600 text-white font-bold text-xl transition-all duration-700 flex items-center gap-4 shadow-2xl min-w-[350px] overflow-hidden", style: {
                                                    ...get3DTransform(1.0),
                                                    boxShadow: `
                      0 30px 60px rgba(59, 130, 246, 0.4),
                      0 0 120px rgba(147, 51, 234, 0.3),
                      inset 0 1px 0 rgba(255, 255, 255, 0.1)
                    `
                                                }, children: [_jsx("div", { className: "absolute inset-0 bg-gradient-to-r from-white/30 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-700" }), _jsx("div", { className: "absolute inset-0 bg-gradient-to-45deg from-cyan-500/20 to-pink-500/20 opacity-0 group-hover:opacity-100 animate-pulse" }), _jsx(PhoneCall, { className: "h-7 w-7 relative z-10" }), _jsx("span", { className: "relative z-10", children: "Start Neural Trial" }), _jsx("div", { className: "relative w-10 h-10 rounded-full bg-white/20 flex items-center justify-center", children: _jsx(ArrowRight, { className: "h-6 w-6 group-hover:translate-x-2 transition-transform" }) })] }), _jsxs(Link, { to: "/support", className: "group px-16 py-6 rounded-2xl border-2 border-white/30 text-white font-bold text-xl hover:bg-white/10 hover:border-white/50 transition-all duration-700 flex items-center gap-4 backdrop-blur-2xl min-w-[350px] relative overflow-hidden", style: get3DTransform(0.6), children: [_jsx("div", { className: "absolute inset-0 bg-gradient-to-r from-white/5 to-transparent translate-y-full group-hover:translate-y-0 transition-transform duration-500" }), _jsxs("div", { className: "w-14 h-14 rounded-full bg-gradient-to-br from-blue-500/30 to-purple-500/30 flex items-center justify-center backdrop-blur-sm relative", children: [_jsx(Play, { className: "h-7 w-7 text-white ml-1" }), _jsx("div", { className: "absolute inset-0 bg-gradient-to-br from-white/20 to-transparent rounded-full animate-pulse" })] }), _jsx("span", { children: "Experience Demo" })] })] })] }), _jsx("div", { className: "relative lg:block hidden", children: _jsxs("div", { className: "relative w-full h-[600px] mx-auto perspective-2000", style: {
                                        ...get3DTransform(1.5, 'device'),
                                        filter: `
                    drop-shadow(0 50px 100px rgba(59, 130, 246, 0.4))
                    drop-shadow(0 80px 160px rgba(147, 51, 234, 0.3))
                  `
                                    }, ref: deviceRef, children: [_jsxs("div", { className: "relative w-96 h-full mx-auto transition-all duration-1200 transform-gpu preserve-3d", style: getDeviceMorphTransform(), children: [deviceState === 'phone' && (_jsxs("div", { className: "absolute inset-0 rounded-[3rem] bg-gradient-to-br from-slate-800 via-slate-900 to-black border-2 border-white/20 shadow-2xl overflow-hidden transform-gpu", children: [_jsx("div", { className: "absolute inset-6 rounded-[2.5rem] bg-black overflow-hidden", children: _jsxs("div", { className: "w-full h-full bg-gradient-to-br from-slate-900 via-black to-indigo-900 relative", children: [_jsxs("div", { className: "flex items-center justify-between p-4 text-white text-sm", children: [_jsx("span", { className: "font-mono font-bold", children: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Signal, { className: "h-4 w-4" }), _jsx(Wifi, { className: "h-4 w-4" }), _jsxs("div", { className: "relative", children: [_jsx(Battery, { className: "h-4 w-4" }), _jsx("div", { className: "absolute inset-0.5 bg-green-400 rounded-sm w-3/4" })] })] })] }), _jsxs("div", { className: "flex flex-col items-center justify-center h-full -mt-12", children: [_jsx("div", { className: "relative mb-12", children: _jsxs("div", { className: "w-40 h-40 rounded-full bg-gradient-to-br from-orange-400 via-red-500 to-red-600 flex items-center justify-center relative overflow-hidden", style: {
                                                                                        boxShadow: `
                                    0 0 60px rgba(239, 68, 68, 0.6),
                                    inset 0 4px 0 rgba(255, 255, 255, 0.3),
                                    inset 0 -4px 0 rgba(0, 0, 0, 0.3)
                                  `,
                                                                                        transform: `scale(${1 + Math.sin(Date.now() / 1500) * 0.03})`
                                                                                    }, children: [_jsx(Utensils, { className: "h-20 w-20 text-white relative z-10" }), _jsx("div", { className: "absolute inset-0 border-4 border-orange-300/40 rounded-full", style: {
                                                                                                animation: 'ping 2s infinite',
                                                                                                transform: `scale(${1 + Math.sin(Date.now() / 800) * 0.1})`
                                                                                            } }), _jsx("div", { className: "absolute inset-4 border-2 border-red-300/30 rounded-full", style: {
                                                                                                animation: 'ping 2s infinite 0.5s',
                                                                                                transform: `scale(${1 + Math.cos(Date.now() / 600) * 0.1})`
                                                                                            } }), _jsx("div", { className: "absolute -bottom-2 -right-2 w-8 h-8 bg-green-500 rounded-full border-2 border-white flex items-center justify-center", children: _jsx("div", { className: "w-3 h-3 bg-white rounded-full animate-pulse" }) })] }) }), _jsxs("div", { className: "text-center mb-12", children: [_jsx("h3", { className: "text-white text-2xl font-bold mb-3", children: "Tony's Italian Kitchen" }), _jsx("p", { className: "text-blue-300 text-lg mb-2", children: "\uD83D\uDCDE Incoming Order Call" }), _jsx("p", { className: "text-gray-400 text-sm font-mono", children: "+1 (555) 123-PIZZA" }), _jsxs("div", { className: "flex items-center justify-center gap-2 mt-3 px-4 py-2 rounded-full bg-green-500/20 border border-green-500/30", children: [_jsx("div", { className: "w-2 h-2 bg-green-400 rounded-full animate-pulse" }), _jsx("span", { className: "text-green-300 text-xs font-semibold", children: "AI Ready" })] })] }), _jsxs("div", { className: "flex items-center gap-16 mb-12", children: [_jsxs("div", { className: "w-20 h-20 rounded-full bg-red-500 flex items-center justify-center shadow-2xl cursor-pointer hover:scale-110 transition-transform relative overflow-hidden", style: {
                                                                                            boxShadow: `
                                    0 0 30px rgba(239, 68, 68, 0.6),
                                    inset 0 2px 0 rgba(255, 255, 255, 0.3)
                                  `
                                                                                        }, children: [_jsx("div", { className: "w-8 h-2 bg-white rounded-full" }), _jsx("div", { className: "absolute inset-0 bg-red-400/30 rounded-full animate-pulse" })] }), _jsxs("div", { className: "w-24 h-24 rounded-full bg-green-500 flex items-center justify-center shadow-2xl cursor-pointer hover:scale-110 transition-transform relative overflow-hidden", style: {
                                                                                            boxShadow: `
                                    0 0 40px rgba(34, 197, 94, 0.8),
                                    inset 0 2px 0 rgba(255, 255, 255, 0.3),
                                    inset 0 -2px 0 rgba(0, 0, 0, 0.2)
                                  `
                                                                                        }, children: [_jsx(PhoneCall, { className: "h-10 w-10 text-white" }), _jsx("div", { className: "absolute inset-0 bg-green-400/40 rounded-full", style: { animation: 'pulse 1.5s infinite' } })] })] }), _jsx("div", { className: "flex items-center gap-1", children: [...Array(9)].map((_, i) => (_jsx("div", { className: "bg-green-400 rounded-full transition-all duration-75", style: {
                                                                                        width: '3px',
                                                                                        height: `${12 + Math.sin(Date.now() / (150 - i * 10) + i * 0.5) * 20 * voiceLevel}px`,
                                                                                        opacity: 0.4 + Math.sin(Date.now() / (200 + i * 20)) * 0.4,
                                                                                        boxShadow: `0 0 8px rgba(34, 197, 94, ${voiceLevel})`
                                                                                    } }, i))) })] })] }) }), _jsx("div", { className: "absolute bottom-8 left-1/2 transform -translate-x-1/2 w-16 h-16 rounded-full border-2 border-white/20 bg-black/40 backdrop-blur-sm" })] })), deviceState === 'pos' && (_jsxs("div", { className: "absolute inset-0 rounded-3xl bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900 border-2 border-white/20 shadow-2xl overflow-hidden", children: [_jsx("div", { className: "absolute inset-8 rounded-2xl bg-black overflow-hidden", children: _jsxs("div", { className: "w-full h-full bg-gradient-to-br from-slate-900 via-black to-slate-800 p-6", children: [_jsxs("div", { className: "flex items-center justify-between mb-8 text-white", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center", children: _jsx(Headphones, { className: "h-6 w-6 text-white" }) }), _jsx("span", { className: "text-xl font-bold", children: "HEYLOO POS" })] }), _jsxs("div", { className: "flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/20 border border-green-500/30", children: [_jsx("div", { className: "w-2 h-2 bg-green-400 rounded-full animate-pulse" }), _jsx("span", { className: "text-green-400 text-sm font-bold", children: "LIVE" })] })] }), _jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "text-white", children: [_jsxs("h3", { className: "text-2xl font-bold mb-4", children: ["Order #AI-", Math.floor(Math.random() * 1000)] }), _jsx("p", { className: "text-blue-300 mb-2", children: "\uD83E\uDD16 AI Processing Voice Order..." })] }), _jsx("div", { className: "space-y-3", children: [
                                                                                    { item: "Margherita Pizza (Large)", price: "$22.99", status: "confirmed" },
                                                                                    { item: "Caesar Salad", price: "$14.99", status: "confirmed" },
                                                                                    { item: "Garlic Bread", price: "$8.99", status: "adding..." }
                                                                                ].map((order, i) => (_jsxs("div", { className: `flex justify-between items-center p-4 rounded-xl transition-all duration-500 ${order.status === 'confirmed'
                                                                                        ? 'bg-green-500/20 border border-green-500/30'
                                                                                        : 'bg-yellow-500/20 border border-yellow-500/30'}`, style: {
                                                                                        transform: `translateX(${order.status === 'adding...' ? Math.sin(Date.now() / 500) * 2 : 0}px)`
                                                                                    }, children: [_jsxs("div", { children: [_jsx("span", { className: "text-gray-200 font-medium", children: order.item }), order.status === 'adding...' && (_jsx("div", { className: "text-yellow-400 text-sm mt-1", children: "AI is confirming..." }))] }), _jsxs("div", { className: "text-right", children: [_jsx("span", { className: "text-green-400 font-bold text-lg", children: order.price }), order.status === 'confirmed' && (_jsx(CheckCircle2, { className: "h-5 w-5 text-green-400 ml-2 inline" }))] })] }, i))) }), _jsxs("div", { className: "border-t border-white/20 pt-4 flex justify-between items-center", children: [_jsx("span", { className: "text-white font-bold text-xl", children: "Total:" }), _jsxs("span", { className: "text-green-400 font-bold text-3xl", style: {
                                                                                            transform: `scale(${1 + Math.sin(Date.now() / 1000) * 0.02})`
                                                                                        }, children: ["$", orderData.total.toFixed(2)] })] }), _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(Activity, { className: "h-5 w-5 text-blue-400" }), _jsx("span", { className: "text-blue-300", children: "Processing with AI..." })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("div", { className: "w-3 h-3 bg-green-500 rounded-full animate-pulse" }), _jsx("span", { className: "text-green-400 text-sm font-bold", children: "Payment Ready" })] })] })] })] }) }), _jsx("div", { className: "absolute -bottom-6 left-1/2 transform -translate-x-1/2 w-24 h-10 bg-slate-600 rounded-lg shadow-xl", children: _jsx("div", { className: "w-full h-full bg-gradient-to-r from-slate-500 to-slate-700 rounded-lg flex items-center justify-center", children: _jsx(CreditCard, { className: "h-5 w-5 text-white" }) }) })] })), deviceState === 'analytics' && (_jsx("div", { className: "absolute inset-0 rounded-3xl bg-gradient-to-br from-slate-800 via-slate-900 to-black border-2 border-white/20 shadow-2xl overflow-hidden", children: _jsx("div", { className: "absolute inset-6 rounded-2xl bg-black overflow-hidden", children: _jsxs("div", { className: "w-full h-full bg-gradient-to-br from-slate-900 via-black to-indigo-900 p-4", children: [_jsxs("div", { className: "flex items-center justify-between mb-6", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(BarChart3, { className: "h-6 w-6 text-blue-400" }), _jsx("span", { className: "text-white font-bold text-lg", children: "Revenue Analytics" })] }), _jsx("div", { className: "text-green-400 text-sm font-mono", children: "REAL-TIME" })] }), _jsx("div", { className: "grid grid-cols-2 gap-4 mb-6", children: [
                                                                        {
                                                                            label: "Today's Revenue",
                                                                            value: `$${(orderData.total * 12.3).toFixed(0)}`,
                                                                            change: "+23%",
                                                                            color: "text-green-400",
                                                                            icon: DollarSign
                                                                        },
                                                                        {
                                                                            label: "Orders",
                                                                            value: `${orderData.items * 8}`,
                                                                            change: "+18%",
                                                                            color: "text-blue-400",
                                                                            icon: Activity
                                                                        },
                                                                        {
                                                                            label: "Avg Order",
                                                                            value: `$${(orderData.total / 2.1).toFixed(2)}`,
                                                                            change: "+12%",
                                                                            color: "text-purple-400",
                                                                            icon: TrendingUp
                                                                        },
                                                                        {
                                                                            label: "AI Accuracy",
                                                                            value: "98.7%",
                                                                            change: "+0.3%",
                                                                            color: "text-emerald-400",
                                                                            icon: CheckCircle2
                                                                        }
                                                                    ].map((metric, i) => (_jsxs("div", { className: "p-3 rounded-xl bg-white/5 border border-white/10", style: {
                                                                            transform: `translateY(${Math.sin(Date.now() / (2000 + i * 500)) * 2}px)`
                                                                        }, children: [_jsxs("div", { className: "flex items-center gap-2 mb-2", children: [_jsx(metric.icon, { className: `h-4 w-4 ${metric.color}` }), _jsx("span", { className: "text-gray-300 text-xs", children: metric.label })] }), _jsxs("div", { className: "flex items-end gap-2", children: [_jsx("span", { className: "text-white font-bold text-lg", children: metric.value }), _jsx("span", { className: `text-xs ${metric.color}`, children: metric.change })] })] }, i))) }), _jsxs("div", { className: "bg-white/5 rounded-xl p-4 border border-white/10", children: [_jsx("div", { className: "text-gray-300 text-sm mb-3", children: "Order Volume (Live)" }), _jsx("div", { className: "flex items-end gap-2 h-24", children: [...Array(12)].map((_, i) => (_jsx("div", { className: "bg-gradient-to-t from-blue-600 to-purple-500 rounded-t-sm flex-1 transition-all duration-300", style: {
                                                                                    height: `${30 + Math.sin(Date.now() / 1000 + i) * 30 + Math.random() * 20}%`,
                                                                                    opacity: 0.6 + Math.sin(Date.now() / 800 + i) * 0.3
                                                                                } }, i))) })] }), _jsxs("div", { className: "mt-4 p-3 rounded-xl bg-gradient-to-r from-blue-500/20 to-purple-500/20 border border-blue-500/30", children: [_jsxs("div", { className: "flex items-center gap-2 mb-2", children: [_jsx("div", { className: "w-2 h-2 bg-blue-400 rounded-full animate-pulse" }), _jsx("span", { className: "text-blue-300 text-xs font-semibold", children: "AI INSIGHT" })] }), _jsx("p", { className: "text-gray-200 text-sm", children: "Peak ordering detected. Recommend activating overflow AI assistant." })] })] }) }) }))] }), [
                                            {
                                                icon: CreditCard,
                                                pos: { top: '15%', right: '15%' },
                                                color: 'from-green-400 to-emerald-500',
                                                delay: 0
                                            },
                                            {
                                                icon: Utensils,
                                                pos: { bottom: '25%', left: '10%' },
                                                color: 'from-orange-400 to-red-500',
                                                delay: 1000
                                            },
                                            {
                                                icon: BarChart3,
                                                pos: { top: '65%', right: '10%' },
                                                color: 'from-purple-400 to-pink-500',
                                                delay: 2000
                                            },
                                            {
                                                icon: Users,
                                                pos: { bottom: '60%', left: '5%' },
                                                color: 'from-blue-400 to-indigo-500',
                                                delay: 1500
                                            }
                                        ].map((item, i) => (_jsx("div", { className: `absolute w-16 h-16 rounded-2xl bg-gradient-to-br ${item.color} flex items-center justify-center shadow-2xl transition-all duration-1000`, style: {
                                                ...item.pos,
                                                transform: `
                        translate3d(
                          ${Math.sin(Date.now() / 4000 + i + item.delay) * 20}px,
                          ${Math.cos(Date.now() / 5000 + i + item.delay) * 15}px,
                          ${Math.sin(Date.now() / 3000 + i) * 30}px
                        ) 
                        rotateX(${Math.sin(Date.now() / 6000 + i) * 15}deg)
                        rotateY(${Math.cos(Date.now() / 7000 + i) * 15}deg)
                        scale(${0.8 + Math.sin(Date.now() / 2000 + i) * 0.2})
                      `,
                                                ...get3DTransform(0.8),
                                                opacity: 0.7 + Math.sin(Date.now() / 4000 + i) * 0.2,
                                                boxShadow: `
                        0 20px 40px rgba(0, 0, 0, 0.3),
                        0 0 20px rgba(59, 130, 246, 0.3),
                        inset 0 1px 0 rgba(255, 255, 255, 0.2)
                      `
                                            }, children: _jsx(item.icon, { className: "h-8 w-8 text-white" }) }, i))), _jsx("div", { className: "absolute -top-20 left-1/2 transform -translate-x-1/2 flex gap-6", children: [
                                                { state: 'phone', label: 'Voice Call', icon: Phone, active: deviceState === 'phone' },
                                                { state: 'pos', label: 'POS System', icon: CreditCard, active: deviceState === 'pos' },
                                                { state: 'analytics', label: 'Analytics', icon: BarChart3, active: deviceState === 'analytics' }
                                            ].map((item, i) => (_jsx("div", { className: `px-4 py-3 rounded-2xl backdrop-blur-2xl border transition-all duration-700 cursor-pointer ${item.active
                                                    ? 'bg-white/20 border-white/40 text-white'
                                                    : 'bg-black/40 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white'}`, style: {
                                                    transform: `scale(${item.active ? 1.1 : 1})`,
                                                    boxShadow: item.active ? '0 10px 30px rgba(59, 130, 246, 0.3)' : 'none'
                                                }, children: _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(item.icon, { className: "h-5 w-5" }), _jsx("span", { className: "text-sm font-semibold", children: item.label }), item.active && (_jsx("div", { className: "w-2 h-2 bg-green-400 rounded-full animate-pulse" }))] }) }, i))) })] }) })] }) }) }), _jsxs("section", { className: "relative py-32 px-6 overflow-hidden", children: [_jsxs("div", { className: "absolute inset-0 bg-gradient-to-br from-black via-slate-900 to-black", children: [_jsx("div", { className: "absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(59,130,246,0.1),transparent)] animate-pulse" }), _jsx("div", { className: "absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(139,92,246,0.1),transparent)]", style: { animationDelay: '1s' } })] }), _jsx("div", { className: "absolute inset-0", children: Array.from({ length: 50 }).map((_, i) => (_jsx("div", { className: "absolute w-1 h-1 bg-blue-400 rounded-full opacity-30", style: {
                                left: `${Math.random() * 100}%`,
                                top: `${Math.random() * 100}%`,
                                transform: `
                  translate3d(
                    ${Math.sin(Date.now() / (3000 + i * 100)) * 50}px,
                    ${Math.cos(Date.now() / (4000 + i * 100)) * 30}px,
                    ${Math.sin(Date.now() / (2000 + i * 50)) * 20}px
                  )
                  scale(${0.5 + Math.sin(Date.now() / (2000 + i * 100)) * 0.5})
                `,
                                animation: `float ${3 + Math.random() * 2}s ease-in-out infinite ${Math.random() * 2}s`,
                                filter: `blur(${Math.random() * 2}px)`
                            } }, i))) }), _jsxs("div", { className: "relative max-w-7xl mx-auto", children: [_jsxs("div", { className: "text-center mb-20", style: get3DTransform(0.3), children: [_jsx("h2", { className: "text-6xl md:text-7xl font-black mb-6", children: ['P', 'o', 'w', 'e', 'r', 'e', 'd', ' ', 'b', 'y', ' ', 'A', 'I'].map((char, i) => (_jsx("span", { className: `inline-block ${char === ' ' ? 'w-4' : ''}`, style: {
                                                background: 'linear-gradient(45deg, #ffffff, #60a5fa, #a855f7)',
                                                backgroundClip: 'text',
                                                WebkitBackgroundClip: 'text',
                                                color: 'transparent',
                                                transform: `
                      perspective(1000px) 
                      rotateX(${Math.sin(Date.now() / 2000 + i * 0.5) * 10}deg)
                      rotateY(${Math.cos(Date.now() / 3000 + i * 0.3) * 5}deg)
                      translateZ(${Math.sin(Date.now() / 1500 + i * 0.4) * 10}px)
                      scale(${1 + Math.sin(Date.now() / 2500 + i * 0.2) * 0.05})
                    `,
                                                textShadow: `
                      0 0 20px rgba(96, 165, 250, 0.5),
                      0 0 40px rgba(168, 85, 247, 0.3),
                      2px 2px 4px rgba(0, 0, 0, 0.5)
                    `,
                                                filter: `drop-shadow(0 10px 20px rgba(59, 130, 246, 0.3))`,
                                                animationDelay: `${i * 0.1}s`
                                            }, children: char }, i))) }), _jsx("p", { className: "text-xl text-gray-300 max-w-2xl mx-auto leading-relaxed", style: {
                                            transform: `translateZ(30px)`,
                                            textShadow: '0 2px 10px rgba(0, 0, 0, 0.5)'
                                        }, children: "Transform your restaurant with cutting-edge AI that understands, processes, and delivers" })] }), _jsx("div", { className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8", children: [
                                    {
                                        value: orderData.total * 847,
                                        label: 'Revenue Generated',
                                        suffix: '',
                                        prefix: '$',
                                        color: 'from-emerald-400 via-green-500 to-emerald-600',
                                        icon: DollarSign,
                                        glow: 'rgba(16, 185, 129, 0.3)'
                                    },
                                    {
                                        value: orderData.items * 2847,
                                        label: 'Orders Processed',
                                        suffix: '+',
                                        prefix: '',
                                        color: 'from-blue-400 via-indigo-500 to-blue-600',
                                        icon: ShoppingCart,
                                        glow: 'rgba(59, 130, 246, 0.3)'
                                    },
                                    {
                                        value: 99.2,
                                        label: 'AI Accuracy Rate',
                                        suffix: '%',
                                        prefix: '',
                                        color: 'from-purple-400 via-violet-500 to-purple-600',
                                        icon: CheckCircle2,
                                        glow: 'rgba(139, 92, 246, 0.3)'
                                    },
                                    {
                                        value: orderData.total / 2.4 * 10,
                                        label: 'Time Saved Daily',
                                        suffix: 'hrs',
                                        prefix: '',
                                        color: 'from-orange-400 via-red-500 to-pink-600',
                                        icon: Clock,
                                        glow: 'rgba(251, 146, 60, 0.3)'
                                    }
                                ].map((stat, i) => (_jsxs("div", { className: "relative group cursor-pointer", style: {
                                        transform: `
                    perspective(1500px) 
                    rotateX(${-mousePosition.y * 5 + Math.sin(Date.now() / 4000 + i) * 3}deg) 
                    rotateY(${mousePosition.x * 5 + Math.cos(Date.now() / 5000 + i) * 3}deg)
                    translateZ(${Math.sin(Date.now() / 3000 + i) * 20}px)
                    scale(${isInteracting ? 1.02 : 1})
                  `,
                                        transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                                        transformStyle: 'preserve-3d'
                                    }, children: [_jsxs("div", { className: "relative bg-gradient-to-br from-white/5 to-white/10 backdrop-blur-2xl rounded-3xl p-8 border border-white/20 shadow-2xl overflow-hidden", style: {
                                                boxShadow: `
                      0 25px 50px rgba(0, 0, 0, 0.3),
                      0 0 40px ${stat.glow},
                      inset 0 1px 0 rgba(255, 255, 255, 0.1),
                      inset 0 -1px 0 rgba(255, 255, 255, 0.05)
                    `
                                            }, children: [_jsx("div", { className: `absolute inset-0 bg-gradient-to-br ${stat.color} opacity-10`, style: {
                                                        transform: `rotate(${Math.sin(Date.now() / 6000 + i) * 5}deg) scale(1.1)`,
                                                        filter: 'blur(20px)'
                                                    } }), _jsx("div", { className: `w-16 h-16 bg-gradient-to-br ${stat.color} rounded-2xl flex items-center justify-center mb-6 shadow-xl`, style: {
                                                        transform: `
                        translateZ(30px) 
                        rotateX(${Math.sin(Date.now() / 2000 + i) * 10}deg)
                        rotateY(${Math.cos(Date.now() / 3000 + i) * 10}deg)
                        scale(${1 + Math.sin(Date.now() / 2500 + i) * 0.1})
                      `,
                                                        boxShadow: `0 10px 30px ${stat.glow}`
                                                    }, children: _jsx(stat.icon, { className: "h-8 w-8 text-white" }) }), _jsxs("div", { className: "relative z-10", children: [_jsx("div", { className: "text-4xl md:text-5xl font-black text-white mb-2", style: {
                                                                transform: `translateZ(20px)`,
                                                                textShadow: `
                          0 0 20px ${stat.glow},
                          0 2px 10px rgba(0, 0, 0, 0.5)
                        `,
                                                                filter: `drop-shadow(0 5px 15px ${stat.glow})`
                                                            }, children: _jsxs("span", { className: "inline-block", children: [stat.prefix, typeof stat.value === 'number'
                                                                        ? Math.floor(stat.value + Math.sin(Date.now() / 1000 + i) * (stat.value * 0.02))
                                                                            .toLocaleString()
                                                                        : stat.value, stat.suffix] }) }), _jsx("p", { className: "text-gray-300 font-medium text-lg", style: {
                                                                transform: `translateZ(10px)`,
                                                                textShadow: '0 1px 5px rgba(0, 0, 0, 0.5)'
                                                            }, children: stat.label })] }), _jsx("div", { className: `absolute inset-0 bg-gradient-to-br ${stat.color} opacity-5`, style: {
                                                        transform: `
                        translateZ(-10px) 
                        rotateZ(${Math.sin(Date.now() / 8000 + i) * 360}deg)
                        scale(${1.5 + Math.sin(Date.now() / 4000 + i) * 0.3})
                      `,
                                                        filter: 'blur(40px)'
                                                    } }), _jsx("div", { className: `absolute inset-0 rounded-3xl border-2 opacity-30`, style: {
                                                        borderColor: stat.glow.replace('0.3', '0.8'),
                                                        transform: `scale(${1 + Math.sin(Date.now() / 2000 + i) * 0.05})`,
                                                        animation: `pulse 3s ease-in-out infinite ${i * 0.5}s`
                                                    } })] }), Array.from({ length: 8 }).map((_, j) => (_jsx("div", { className: `absolute w-3 h-3 bg-gradient-to-r ${stat.color} rounded-full opacity-60`, style: {
                                                left: `${20 + Math.random() * 60}%`,
                                                top: `${20 + Math.random() * 60}%`,
                                                transform: `
                        translate3d(
                          ${Math.sin(Date.now() / (2000 + j * 300 + i * 500)) * 30}px,
                          ${Math.cos(Date.now() / (3000 + j * 400 + i * 600)) * 25}px,
                          ${Math.sin(Date.now() / (1500 + j * 200)) * 15}px
                        )
                        scale(${0.3 + Math.sin(Date.now() / (1000 + j * 100)) * 0.7})
                      `,
                                                boxShadow: `0 0 10px ${stat.glow}`,
                                                filter: 'blur(1px)'
                                            } }, j)))] }, i))) }), _jsx("div", { className: "absolute top-1/2 left-0 transform -translate-y-1/2 -translate-x-20", children: _jsx("div", { className: "w-24 h-24 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full flex items-center justify-center shadow-2xl", style: {
                                        transform: `
                  perspective(1000px)
                  rotateY(${Math.sin(Date.now() / 3000) * 20}deg)
                  rotateX(${Math.cos(Date.now() / 4000) * 15}deg)
                  translateZ(${Math.sin(Date.now() / 2000) * 30}px)
                `,
                                        boxShadow: '0 20px 40px rgba(251, 191, 36, 0.4)'
                                    }, children: _jsx(Star, { className: "h-12 w-12 text-white" }) }) }), _jsx("div", { className: "absolute top-1/4 right-0 transform translate-x-20", children: _jsx("div", { className: "w-20 h-20 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-full flex items-center justify-center shadow-2xl", style: {
                                        transform: `
                  perspective(1000px)
                  rotateY(${Math.cos(Date.now() / 2500) * 25}deg)
                  rotateX(${Math.sin(Date.now() / 3500) * 20}deg)
                  translateZ(${Math.cos(Date.now() / 1800) * 25}px)
                `,
                                        boxShadow: '0 15px 30px rgba(16, 185, 129, 0.4)',
                                        animationDelay: '1s'
                                    }, children: _jsx(Award, { className: "h-10 w-10 text-white" }) }) })] })] }), _jsxs("section", { className: "relative py-32 px-6 overflow-hidden bg-gradient-to-br from-slate-950 via-black to-slate-900", children: [_jsx("div", { className: "absolute inset-0", children: _jsx("div", { className: "absolute inset-0 opacity-20", style: {
                                backgroundImage: `
                linear-gradient(rgba(59, 130, 246, 0.1) 1px, transparent 1px),
                linear-gradient(90deg, rgba(59, 130, 246, 0.1) 1px, transparent 1px)
              `,
                                backgroundSize: '50px 50px',
                                transform: `
                perspective(1000px) 
                rotateX(60deg) 
                translateZ(-200px)
                scale(${1 + Math.sin(Date.now() / 8000) * 0.1})
              `
                            } }) }), _jsxs("div", { className: "relative max-w-7xl mx-auto", children: [_jsxs("div", { className: "text-center mb-20", children: [_jsx("h2", { className: "text-6xl md:text-7xl font-black text-white mb-6", style: {
                                            transform: `translateZ(50px)`,
                                            textShadow: `
                  0 0 30px rgba(59, 130, 246, 0.5),
                  0 5px 15px rgba(0, 0, 0, 0.5)
                `,
                                            background: 'linear-gradient(45deg, #ffffff, #60a5fa, #a855f7)',
                                            backgroundClip: 'text',
                                            WebkitBackgroundClip: 'text'
                                        }, children: "Revolutionary Features" }), _jsx("p", { className: "text-xl text-gray-300 max-w-3xl mx-auto", children: "Experience the future of restaurant automation with AI that thinks, learns, and evolves" })] }), _jsx("div", { className: "grid grid-cols-1 lg:grid-cols-3 gap-12", children: [
                                    {
                                        title: 'Voice AI Assistant',
                                        description: 'Natural conversation that understands context, accents, and complex orders',
                                        icon: Phone,
                                        color: 'from-blue-400 to-indigo-600',
                                        demo: 'phone',
                                        features: ['Multi-language support', 'Context awareness', 'Emotion detection', 'Background noise filtering']
                                    },
                                    {
                                        title: 'Smart POS Integration',
                                        description: 'Seamlessly integrates with your existing POS system for instant order processing',
                                        icon: CreditCard,
                                        color: 'from-green-400 to-emerald-600',
                                        demo: 'pos',
                                        features: ['Real-time sync', 'Inventory management', 'Payment processing', 'Receipt generation']
                                    },
                                    {
                                        title: 'Advanced Analytics',
                                        description: 'Deep insights into customer behavior, peak hours, and revenue optimization',
                                        icon: BarChart3,
                                        color: 'from-purple-400 to-violet-600',
                                        demo: 'analytics',
                                        features: ['Customer insights', 'Revenue forecasting', 'Peak hour analysis', 'Menu optimization']
                                    }
                                ].map((feature, i) => (_jsx("div", { className: "relative group", style: {
                                        transform: `
                    perspective(1500px) 
                    rotateX(${-mousePosition.y * 3}deg) 
                    rotateY(${mousePosition.x * 3}deg)
                    translateZ(${Math.sin(Date.now() / 4000 + i * 0.5) * 10}px)
                  `,
                                        transition: 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
                                        transformStyle: 'preserve-3d'
                                    }, children: _jsxs("div", { className: "relative bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-xl rounded-3xl p-8 border border-white/20 shadow-2xl overflow-hidden", children: [_jsx("div", { className: `w-20 h-20 bg-gradient-to-br ${feature.color} rounded-3xl flex items-center justify-center mb-8 shadow-2xl`, style: {
                                                    transform: `
                        translateZ(40px) 
                        rotateX(${Math.sin(Date.now() / 3000 + i) * 15}deg)
                        rotateY(${Math.cos(Date.now() / 4000 + i) * 15}deg)
                      `,
                                                    boxShadow: `0 20px 40px ${feature.color.includes('blue') ? 'rgba(59, 130, 246, 0.3)' :
                                                        feature.color.includes('green') ? 'rgba(16, 185, 129, 0.3)' : 'rgba(139, 92, 246, 0.3)'}`
                                                }, children: _jsx(feature.icon, { className: "h-10 w-10 text-white" }) }), _jsxs("div", { className: "relative z-10", children: [_jsx("h3", { className: "text-2xl font-bold text-white mb-4", style: {
                                                            transform: `translateZ(30px)`,
                                                            textShadow: '0 2px 10px rgba(0, 0, 0, 0.5)'
                                                        }, children: feature.title }), _jsx("p", { className: "text-gray-300 mb-6 leading-relaxed", style: {
                                                            transform: `translateZ(20px)`
                                                        }, children: feature.description }), _jsx("ul", { className: "space-y-3", children: feature.features.map((item, j) => (_jsxs("li", { className: "flex items-center gap-3 text-gray-200", style: {
                                                                transform: `translateZ(${10 + j * 5}px)`,
                                                                opacity: 0.8 + Math.sin(Date.now() / 2000 + j) * 0.2
                                                            }, children: [_jsx(CheckCircle2, { className: "h-5 w-5 text-green-400" }), _jsx("span", { children: item })] }, j))) })] }), _jsx("button", { className: `mt-8 px-6 py-3 bg-gradient-to-r ${feature.color} rounded-2xl text-white font-semibold shadow-xl transition-all duration-300 hover:scale-105`, style: {
                                                    transform: `translateZ(50px)`,
                                                    boxShadow: `0 10px 30px ${feature.color.includes('blue') ? 'rgba(59, 130, 246, 0.4)' :
                                                        feature.color.includes('green') ? 'rgba(16, 185, 129, 0.4)' : 'rgba(139, 92, 246, 0.4)'}`
                                                }, children: "Try Demo" }), _jsx("div", { className: `absolute inset-0 bg-gradient-to-br ${feature.color} opacity-5`, style: {
                                                    transform: `translateZ(-20px) rotate(${Math.sin(Date.now() / 6000 + i) * 10}deg)`,
                                                    filter: 'blur(30px)'
                                                } })] }) }, i))) })] })] }), _jsxs("section", { className: "relative py-32 px-6 overflow-hidden bg-gradient-to-br from-black via-slate-900 to-indigo-950", children: [_jsxs("div", { className: "absolute inset-0", children: [_jsx("div", { className: "absolute inset-0 opacity-10", style: {
                                    backgroundImage: `
                radial-gradient(circle at 25% 25%, rgba(59, 130, 246, 0.3) 2px, transparent 2px),
                radial-gradient(circle at 75% 25%, rgba(139, 92, 246, 0.3) 2px, transparent 2px),
                radial-gradient(circle at 25% 75%, rgba(16, 185, 129, 0.3) 2px, transparent 2px),
                radial-gradient(circle at 75% 75%, rgba(251, 191, 36, 0.3) 2px, transparent 2px)
              `,
                                    backgroundSize: '100px 100px',
                                    transform: `translateZ(-100px) scale(${1 + Math.sin(Date.now() / 10000) * 0.1})`
                                } }), Array.from({ length: 20 }).map((_, i) => (_jsx("div", { className: "absolute bg-gradient-to-r from-transparent via-blue-400 to-transparent opacity-20", style: {
                                    width: `${200 + Math.random() * 400}px`,
                                    height: '1px',
                                    left: `${Math.random() * 100}%`,
                                    top: `${Math.random() * 100}%`,
                                    transform: `
                  rotate(${Math.random() * 180}deg) 
                  translateY(${Math.sin(Date.now() / (5000 + i * 200)) * 20}px)
                `,
                                    animation: `pulse 4s ease-in-out infinite ${Math.random() * 2}s`
                                } }, i)))] }), _jsxs("div", { className: "relative max-w-7xl mx-auto", children: [_jsxs("div", { className: "text-center mb-20", children: [_jsx("h2", { className: "text-6xl md:text-7xl font-black text-white mb-6", style: {
                                            transform: `translateZ(50px)`,
                                            background: 'linear-gradient(45deg, #ffffff, #60a5fa, #a855f7, #10b981)',
                                            backgroundClip: 'text',
                                            WebkitBackgroundClip: 'text',
                                            color: 'transparent',
                                            textShadow: '0 0 40px rgba(59, 130, 246, 0.3)'
                                        }, children: "Seamless Integrations" }), _jsx("p", { className: "text-xl text-gray-300 max-w-3xl mx-auto leading-relaxed", children: "Connect with your existing systems effortlessly. One AI, unlimited possibilities." })] }), _jsxs("div", { className: "relative", children: [_jsx("div", { className: "flex justify-center mb-16", children: _jsxs("div", { className: "relative w-48 h-48 bg-gradient-to-br from-blue-500 via-purple-600 to-indigo-700 rounded-full shadow-2xl", style: {
                                                transform: `
                    perspective(1500px) 
                    rotateX(${-mousePosition.y * 10}deg) 
                    rotateY(${mousePosition.x * 10}deg)
                    translateZ(${Math.sin(Date.now() / 3000) * 20}px)
                    scale(${1 + Math.sin(Date.now() / 4000) * 0.1})
                  `,
                                                boxShadow: `
                    0 30px 60px rgba(59, 130, 246, 0.4),
                    0 0 100px rgba(139, 92, 246, 0.3),
                    inset 0 0 50px rgba(255, 255, 255, 0.1)
                  `
                                            }, children: [_jsx("div", { className: "absolute inset-0 flex items-center justify-center", children: _jsx("div", { className: "w-24 h-24 bg-gradient-to-br from-white to-blue-100 rounded-2xl flex items-center justify-center shadow-xl", style: {
                                                            transform: `
                        translateZ(30px) 
                        rotateY(${Math.sin(Date.now() / 2000) * 15}deg)
                      `
                                                        }, children: _jsx(Headphones, { className: "h-12 w-12 text-blue-600" }) }) }), _jsx("div", { className: "absolute inset-4 border-2 border-white/30 rounded-full", style: {
                                                        transform: `rotateZ(${Date.now() / 50}deg)`,
                                                        animation: 'spin 20s linear infinite'
                                                    } }), _jsx("div", { className: "absolute inset-8 border-2 border-purple-400/40 rounded-full", style: {
                                                        transform: `rotateZ(${-Date.now() / 70}deg)`,
                                                        animation: 'spin 15s linear infinite reverse'
                                                    } }), [1, 2, 3].map((ring, i) => (_jsx("div", { className: "absolute inset-0 border-2 border-blue-400 rounded-full opacity-20", style: {
                                                        transform: `scale(${1 + (i + 1) * 0.3 + Math.sin(Date.now() / 2000 + i) * 0.2})`,
                                                        animation: `pulse 3s ease-in-out infinite ${i * 0.5}s`
                                                    } }, i)))] }) }), _jsx("div", { className: "relative", children: [
                                            {
                                                name: 'Square',
                                                color: 'from-black to-gray-800',
                                                position: { x: -350, y: -200 },
                                                icon: CreditCard,
                                                glow: 'rgba(0, 0, 0, 0.3)'
                                            },
                                            {
                                                name: 'Toast',
                                                color: 'from-orange-500 to-red-600',
                                                position: { x: 350, y: -200 },
                                                icon: Utensils,
                                                glow: 'rgba(251, 146, 60, 0.3)'
                                            },
                                            {
                                                name: 'Clover',
                                                color: 'from-green-500 to-emerald-600',
                                                position: { x: -400, y: 100 },
                                                icon: Building2,
                                                glow: 'rgba(16, 185, 129, 0.3)'
                                            },
                                            {
                                                name: 'OpenTable',
                                                color: 'from-red-500 to-pink-600',
                                                position: { x: 400, y: 100 },
                                                icon: Users,
                                                glow: 'rgba(239, 68, 68, 0.3)'
                                            },
                                            {
                                                name: 'Stripe',
                                                color: 'from-purple-600 to-indigo-700',
                                                position: { x: -200, y: 250 },
                                                icon: CreditCard,
                                                glow: 'rgba(139, 92, 246, 0.3)'
                                            },
                                            {
                                                name: 'QuickBooks',
                                                color: 'from-blue-600 to-indigo-700',
                                                position: { x: 200, y: 250 },
                                                icon: BarChart3,
                                                glow: 'rgba(59, 130, 246, 0.3)'
                                            }
                                        ].map((brand, i) => {
                                            const orbitRadius = 300;
                                            const angle = (i / 6) * Math.PI * 2 + Date.now() / 8000;
                                            const dynamicX = Math.cos(angle) * orbitRadius;
                                            const dynamicY = Math.sin(angle) * (orbitRadius * 0.6);
                                            return (_jsxs("div", { className: "absolute transition-all duration-1000", style: {
                                                    left: '50%',
                                                    top: '50%',
                                                    transform: `
                        translate(-50%, -50%) 
                        translate(${dynamicX}px, ${dynamicY}px)
                        perspective(1000px) 
                        rotateX(${-mousePosition.y * 5}deg) 
                        rotateY(${mousePosition.x * 5}deg)
                        translateZ(${Math.sin(Date.now() / 3000 + i * 0.8) * 30}px)
                        scale(${0.8 + Math.sin(Date.now() / 4000 + i * 0.5) * 0.2})
                      `
                                                }, children: [_jsx("div", { className: "absolute bg-gradient-to-r from-transparent via-blue-400 to-transparent opacity-30", style: {
                                                            width: `${Math.sqrt(dynamicX ** 2 + dynamicY ** 2)}px`,
                                                            height: '2px',
                                                            left: '50%',
                                                            top: '50%',
                                                            transformOrigin: 'left center',
                                                            transform: `
                          translate(-${Math.sqrt(dynamicX ** 2 + dynamicY ** 2)}px, -1px)
                          rotate(${Math.atan2(dynamicY, dynamicX)}rad)
                        `,
                                                            opacity: 0.3 + Math.sin(Date.now() / 2000 + i) * 0.2
                                                        } }), _jsxs("div", { className: `w-32 h-32 bg-gradient-to-br ${brand.color} rounded-2xl shadow-2xl flex flex-col items-center justify-center border border-white/20 backdrop-blur-sm cursor-pointer group transition-all duration-500 hover:scale-110`, style: {
                                                            boxShadow: `
                          0 20px 40px ${brand.glow},
                          0 0 30px ${brand.glow},
                          inset 0 1px 0 rgba(255, 255, 255, 0.1)
                        `,
                                                            transform: `translateZ(${Math.sin(Date.now() / 2500 + i) * 10}px)`
                                                        }, children: [_jsx("div", { className: "w-12 h-12 flex items-center justify-center mb-2", style: {
                                                                    transform: `rotateY(${Math.sin(Date.now() / 2000 + i) * 20}deg)`
                                                                }, children: _jsx(brand.icon, { className: "h-8 w-8 text-white" }) }), _jsx("span", { className: "text-white font-bold text-sm", style: {
                                                                    textShadow: '0 2px 10px rgba(0, 0, 0, 0.5)'
                                                                }, children: brand.name }), _jsx("div", { className: "absolute -top-2 -right-2 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center border-2 border-white shadow-lg", style: {
                                                                    animation: `pulse 2s ease-in-out infinite ${i * 0.3}s`
                                                                }, children: _jsx(CheckCircle2, { className: "h-3 w-3 text-white" }) }), _jsx("div", { className: "absolute w-3 h-3 bg-blue-400 rounded-full opacity-70", style: {
                                                                    transform: `
                            translate(${Math.sin(Date.now() / 1000 + i) * 40}px, ${Math.cos(Date.now() / 1200 + i) * 30}px)
                            scale(${0.5 + Math.sin(Date.now() / 800 + i) * 0.5})
                          `,
                                                                    boxShadow: '0 0 10px rgba(59, 130, 246, 0.8)'
                                                                } })] })] }, i));
                                        }) }), _jsx("div", { className: "mt-20 grid grid-cols-1 md:grid-cols-3 gap-8", children: [
                                            {
                                                title: 'Real-Time Sync',
                                                description: 'Instant data synchronization across all your restaurant systems',
                                                icon: Wifi,
                                                color: 'from-blue-500 to-indigo-600'
                                            },
                                            {
                                                title: 'Zero Downtime',
                                                description: 'Seamless integration without disrupting your daily operations',
                                                icon: Shield,
                                                color: 'from-green-500 to-emerald-600'
                                            },
                                            {
                                                title: 'Smart Analytics',
                                                description: 'Unified insights from all your integrated platforms',
                                                icon: TrendingUp,
                                                color: 'from-purple-500 to-violet-600'
                                            }
                                        ].map((benefit, i) => (_jsxs("div", { className: "relative bg-white/5 backdrop-blur-xl rounded-2xl p-8 border border-white/10 shadow-xl", style: {
                                                transform: `
                      perspective(1000px) 
                      rotateX(${-mousePosition.y * 2}deg) 
                      rotateY(${mousePosition.x * 2}deg)
                      translateZ(${Math.sin(Date.now() / 4000 + i * 0.7) * 10}px)
                    `
                                            }, children: [_jsx("div", { className: `w-16 h-16 bg-gradient-to-br ${benefit.color} rounded-2xl flex items-center justify-center mb-6 shadow-lg`, style: {
                                                        transform: `translateZ(20px) rotateY(${Math.sin(Date.now() / 3000 + i) * 10}deg)`
                                                    }, children: _jsx(benefit.icon, { className: "h-8 w-8 text-white" }) }), _jsx("h3", { className: "text-xl font-bold text-white mb-3", children: benefit.title }), _jsx("p", { className: "text-gray-300 leading-relaxed", children: benefit.description })] }, i))) })] })] })] }), _jsxs("section", { className: "relative py-32 px-6 overflow-hidden bg-gradient-to-br from-slate-950 via-black to-slate-900", children: [_jsx("div", { className: "absolute inset-0 overflow-hidden", children: Array.from({ length: 12 }).map((_, i) => (_jsx("div", { className: "absolute text-white/5 text-8xl font-serif select-none pointer-events-none", style: {
                                left: `${Math.random() * 100}%`,
                                top: `${Math.random() * 100}%`,
                                transform: `
                  translate(-50%, -50%) 
                  rotate(${Math.random() * 360}deg)
                  scale(${0.5 + Math.random() * 1})
                  translateZ(${Math.sin(Date.now() / (4000 + i * 300)) * 30}px)
                `,
                                opacity: 0.1 + Math.sin(Date.now() / (3000 + i * 200)) * 0.05
                            }, children: "\"" }, i))) }), _jsxs("div", { className: "relative max-w-7xl mx-auto", children: [_jsxs("div", { className: "text-center mb-20", children: [_jsx("h2", { className: "text-6xl md:text-7xl font-black text-white mb-6", style: {
                                            background: 'linear-gradient(45deg, #ffffff, #60a5fa, #a855f7)',
                                            backgroundClip: 'text',
                                            WebkitBackgroundClip: 'text',
                                            color: 'transparent',
                                            textShadow: '0 0 30px rgba(59, 130, 246, 0.3)'
                                        }, children: "Restaurant Success Stories" }), _jsx("p", { className: "text-xl text-gray-300 max-w-3xl mx-auto", children: "Discover how restaurants transformed their operations with our AI assistant" })] }), _jsx("div", { className: "grid grid-cols-1 lg:grid-cols-3 gap-8", children: [
                                    {
                                        name: "Maria Rodriguez",
                                        restaurant: "Bella Vista Italian",
                                        location: "San Francisco, CA",
                                        quote: "Our phone orders increased by 340% since implementing the AI assistant. It never gets tired, never makes mistakes, and our customers love the seamless experience.",
                                        rating: 5,
                                        avatar: "MR",
                                        color: "from-rose-400 to-pink-600",
                                        revenue: "+$127K/month"
                                    },
                                    {
                                        name: "David Chen",
                                        restaurant: "Golden Dragon",
                                        location: "New York, NY",
                                        quote: "The multilingual support is incredible. Our AI handles Mandarin, English, and Spanish orders flawlessly. It's like having a perfect trilingual host 24/7.",
                                        rating: 5,
                                        avatar: "DC",
                                        color: "from-amber-400 to-orange-600",
                                        revenue: "+$89K/month"
                                    },
                                    {
                                        name: "James Thompson",
                                        restaurant: "BBQ Kingdom",
                                        location: "Austin, TX",
                                        quote: "Integration with our Toast POS was seamless. Orders flow directly into our system, and the analytics help us optimize our menu based on AI insights.",
                                        rating: 5,
                                        avatar: "JT",
                                        color: "from-emerald-400 to-green-600",
                                        revenue: "+$156K/month"
                                    }
                                ].map((testimonial, i) => (_jsx("div", { className: "relative group", style: {
                                        transform: `
                    perspective(1500px) 
                    rotateX(${-mousePosition.y * 3}deg) 
                    rotateY(${mousePosition.x * 3}deg)
                    translateZ(${Math.sin(Date.now() / 4000 + i * 0.8) * 15}px)
                    scale(${0.95 + Math.sin(Date.now() / 5000 + i * 0.6) * 0.05})
                  `,
                                        transition: 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)'
                                    }, children: _jsxs("div", { className: "relative bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-2xl rounded-3xl p-8 border border-white/20 shadow-2xl overflow-hidden", children: [_jsx("div", { className: "absolute -top-3 -right-3 bg-gradient-to-r from-green-500 to-emerald-600 px-4 py-2 rounded-2xl shadow-xl", style: {
                                                    transform: `translateZ(30px) rotateX(${Math.sin(Date.now() / 2500 + i) * 10}deg)`,
                                                    boxShadow: '0 10px 30px rgba(16, 185, 129, 0.4)'
                                                }, children: _jsx("span", { className: "text-white font-bold text-sm", children: testimonial.revenue }) }), _jsxs("div", { className: "mb-8", children: [_jsx("div", { className: "text-6xl text-blue-400/20 mb-4", style: { transform: 'translateZ(10px)' }, children: "\"" }), _jsx("p", { className: "text-gray-200 text-lg leading-relaxed italic", style: {
                                                            transform: 'translateZ(20px)',
                                                            textShadow: '0 2px 10px rgba(0, 0, 0, 0.3)'
                                                        }, children: testimonial.quote })] }), _jsxs("div", { className: "flex items-center gap-4", children: [_jsx("div", { className: `w-16 h-16 bg-gradient-to-br ${testimonial.color} rounded-full flex items-center justify-center shadow-xl border-2 border-white/20`, style: {
                                                            transform: `
                          translateZ(40px) 
                          rotateY(${Math.sin(Date.now() / 3000 + i) * 15}deg)
                          scale(${1 + Math.sin(Date.now() / 2000 + i) * 0.1})
                        `,
                                                            boxShadow: `
                          0 15px 30px ${testimonial.color.includes('rose') ? 'rgba(244, 63, 94, 0.3)' :
                                                                testimonial.color.includes('amber') ? 'rgba(245, 158, 11, 0.3)' :
                                                                    'rgba(16, 185, 129, 0.3)'}`
                                                        }, children: _jsx("span", { className: "text-white font-bold text-lg", children: testimonial.avatar }) }), _jsxs("div", { style: { transform: 'translateZ(25px)' }, children: [_jsx("h4", { className: "text-white font-bold text-lg", children: testimonial.name }), _jsx("p", { className: "text-gray-400 text-sm", children: testimonial.restaurant }), _jsx("p", { className: "text-gray-500 text-xs", children: testimonial.location })] })] }), _jsx("div", { className: "flex gap-1 mt-6", style: { transform: 'translateZ(30px)' }, children: Array.from({ length: testimonial.rating }).map((_, starIndex) => (_jsx(Star, { className: "h-5 w-5 text-yellow-400 fill-current", style: {
                                                        transform: `
                            rotateY(${Math.sin(Date.now() / 1500 + starIndex * 0.3) * 20}deg)
                            scale(${1 + Math.sin(Date.now() / 1000 + starIndex * 0.2) * 0.1})
                          `,
                                                        filter: 'drop-shadow(0 2px 5px rgba(251, 191, 36, 0.3))'
                                                    } }, starIndex))) }), _jsx("div", { className: `absolute inset-0 bg-gradient-to-br ${testimonial.color} opacity-5`, style: {
                                                    transform: `translateZ(-10px) rotate(${Math.sin(Date.now() / 6000 + i) * 5}deg)`,
                                                    filter: 'blur(20px)'
                                                } })] }) }, i))) })] })] }), _jsxs("section", { className: "relative py-32 px-6 overflow-hidden bg-gradient-to-br from-indigo-950 via-purple-950 to-black", children: [_jsxs("div", { className: "absolute inset-0", children: [Array.from({ length: 8 }).map((_, i) => (_jsx("div", { className: "absolute inset-0 opacity-10", style: {
                                    background: `radial-gradient(ellipse at ${20 + i * 10}% ${30 + i * 8}%, rgba(59, 130, 246, 0.3), transparent 60%)`,
                                    transform: `scale(${1 + Math.sin(Date.now() / (3000 + i * 500)) * 0.3})`,
                                    filter: `blur(${2 + i}px)`
                                } }, i))), Array.from({ length: 15 }).map((_, i) => (_jsx("div", { className: "absolute bg-gradient-to-r from-blue-400/20 to-purple-400/20 rounded-full", style: {
                                    width: `${20 + Math.random() * 80}px`,
                                    height: `${20 + Math.random() * 80}px`,
                                    left: `${Math.random() * 100}%`,
                                    top: `${Math.random() * 100}%`,
                                    transform: `
                  translate3d(
                    ${Math.sin(Date.now() / (4000 + i * 300)) * 100}px,
                    ${Math.cos(Date.now() / (5000 + i * 200)) * 80}px,
                    ${Math.sin(Date.now() / (3000 + i * 100)) * 40}px
                  )
                  rotateZ(${Date.now() / (2000 + i * 100)}deg)
                  scale(${0.5 + Math.sin(Date.now() / (2500 + i * 150)) * 0.5})
                `,
                                    opacity: 0.3 + Math.sin(Date.now() / (4000 + i * 200)) * 0.2
                                } }, i)))] }), _jsxs("div", { className: "relative max-w-6xl mx-auto", children: [_jsxs("div", { className: "text-center mb-16", children: [_jsx("h2", { className: "text-7xl md:text-8xl font-black mb-8", style: {
                                            background: 'linear-gradient(45deg, #ffffff, #60a5fa, #a855f7, #ec4899)',
                                            backgroundClip: 'text',
                                            WebkitBackgroundClip: 'text',
                                            color: 'transparent',
                                            transform: 'translateZ(50px)',
                                            textShadow: `
                  0 0 40px rgba(59, 130, 246, 0.4),
                  0 0 80px rgba(139, 92, 246, 0.3)
                `,
                                            filter: 'drop-shadow(0 10px 20px rgba(0, 0, 0, 0.3))'
                                        }, children: "Ready to Transform?" }), _jsx("p", { className: "text-2xl text-gray-200 max-w-4xl mx-auto mb-12 leading-relaxed", style: {
                                            transform: 'translateZ(30px)',
                                            textShadow: '0 2px 15px rgba(0, 0, 0, 0.5)'
                                        }, children: "Join thousands of restaurants already using AI to boost revenue, improve customer experience, and streamline operations" }), _jsx("div", { className: "grid grid-cols-2 md:grid-cols-4 gap-8 mb-16", children: [
                                            { label: 'Revenue Increase', value: '340%', color: 'text-green-400' },
                                            { label: 'Order Accuracy', value: '99.7%', color: 'text-blue-400' },
                                            { label: 'Customer Satisfaction', value: '4.9/5', color: 'text-purple-400' },
                                            { label: 'Time Saved', value: '15hrs/day', color: 'text-orange-400' }
                                        ].map((stat, i) => (_jsxs("div", { className: "text-center", style: {
                                                transform: `
                      perspective(1000px) 
                      rotateX(${-mousePosition.y * 2}deg) 
                      rotateY(${mousePosition.x * 2}deg)
                      translateZ(${Math.sin(Date.now() / 3000 + i * 0.5) * 20}px)
                    `
                                            }, children: [_jsx("div", { className: `text-4xl md:text-5xl font-black ${stat.color} mb-2`, style: {
                                                        transform: `scale(${1 + Math.sin(Date.now() / 2000 + i) * 0.05})`,
                                                        textShadow: `0 0 20px ${stat.color.replace('text-', 'rgba(').replace('-400', ', 0.5)')}`
                                                    }, children: stat.value }), _jsx("div", { className: "text-gray-300 font-medium", children: stat.label })] }, i))) })] }), _jsxs("div", { className: "flex flex-col md:flex-row items-center justify-center gap-8 mb-20", children: [_jsxs("button", { className: "group relative px-12 py-6 bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-700 rounded-3xl text-white font-bold text-xl shadow-2xl transition-all duration-500 hover:scale-105 hover:shadow-blue-500/25", style: {
                                            transform: `
                  perspective(1500px) 
                  rotateX(${-mousePosition.y * 5}deg) 
                  rotateY(${mousePosition.x * 5}deg)
                  translateZ(${Math.sin(Date.now() / 3000) * 15}px)
                `,
                                            boxShadow: `
                  0 20px 60px rgba(59, 130, 246, 0.4),
                  0 0 40px rgba(139, 92, 246, 0.3),
                  inset 0 1px 0 rgba(255, 255, 255, 0.2)
                `
                                        }, children: [_jsxs("div", { className: "flex items-center gap-4", children: [_jsx("span", { style: { transform: 'translateZ(10px)' }, children: "Start Free Trial" }), _jsx(ArrowRight, { className: "h-6 w-6 transition-transform duration-300 group-hover:translate-x-2", style: { transform: 'translateZ(15px)' } })] }), _jsx("div", { className: "absolute inset-0 border-2 border-white/30 rounded-3xl", style: {
                                                    transform: `scale(${1 + Math.sin(Date.now() / 2000) * 0.05})`,
                                                    animation: 'pulse 2s ease-in-out infinite'
                                                } }), Array.from({ length: 6 }).map((_, i) => (_jsx("div", { className: "absolute w-2 h-2 bg-white rounded-full opacity-60", style: {
                                                    left: `${20 + Math.random() * 60}%`,
                                                    top: `${20 + Math.random() * 60}%`,
                                                    transform: `
                      translate3d(
                        ${Math.sin(Date.now() / (1500 + i * 200)) * 20}px,
                        ${Math.cos(Date.now() / (2000 + i * 150)) * 15}px,
                        ${Math.sin(Date.now() / (1000 + i * 100)) * 10}px
                      )
                      scale(${0.3 + Math.sin(Date.now() / (800 + i * 50)) * 0.7})
                    `,
                                                    boxShadow: '0 0 10px rgba(255, 255, 255, 0.8)'
                                                } }, i)))] }), _jsx("button", { className: "group relative px-12 py-6 bg-gradient-to-r from-gray-800/50 to-gray-900/50 backdrop-blur-xl border-2 border-white/20 rounded-3xl text-white font-bold text-xl shadow-xl transition-all duration-500 hover:scale-105 hover:bg-white/10", style: {
                                            transform: `
                  perspective(1500px) 
                  rotateX(${-mousePosition.y * 3}deg) 
                  rotateY(${mousePosition.x * 3}deg)
                  translateZ(${Math.cos(Date.now() / 3500) * 10}px)
                `
                                        }, children: _jsxs("div", { className: "flex items-center gap-4", children: [_jsx(Play, { className: "h-6 w-6", style: { transform: 'translateZ(15px)' } }), _jsx("span", { style: { transform: 'translateZ(10px)' }, children: "Watch Demo" })] }) })] }), _jsxs("div", { className: "text-center", children: [_jsx("p", { className: "text-gray-400 mb-8", children: "Trusted by restaurants worldwide" }), _jsx("div", { className: "flex items-center justify-center gap-12 opacity-60", children: ['SOC 2', 'GDPR', 'CCPA', 'PCI DSS'].map((cert, i) => (_jsx("div", { className: "text-gray-400 font-semibold text-lg", style: {
                                                transform: `translateY(${Math.sin(Date.now() / (2000 + i * 500)) * 5}px)`
                                            }, children: cert }, i))) })] })] })] }), _jsxs("footer", { className: "relative bg-gradient-to-br from-black via-slate-900 to-indigo-950 py-20 px-6 overflow-hidden", children: [_jsx("div", { className: "absolute inset-0", children: _jsx("div", { className: "absolute inset-0 opacity-5", style: {
                                backgroundImage: `
                radial-gradient(circle at 25% 25%, rgba(59, 130, 246, 0.2) 2px, transparent 2px),
                radial-gradient(circle at 75% 75%, rgba(139, 92, 246, 0.2) 2px, transparent 2px)
              `,
                                backgroundSize: '100px 100px',
                                transform: `translateZ(-50px) scale(${1 + Math.sin(Date.now() / 15000) * 0.05})`
                            } }) }), _jsxs("div", { className: "relative max-w-7xl mx-auto", children: [_jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12", children: [_jsxs("div", { className: "space-y-6", style: {
                                            transform: `translateZ(20px) rotateY(${Math.sin(Date.now() / 8000) * 2}deg)`
                                        }, children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "w-12 h-12 bg-gradient-to-br from-blue-600 to-purple-700 rounded-2xl flex items-center justify-center shadow-xl", style: {
                                                            transform: `
                      rotateX(${Math.sin(Date.now() / 3000) * 10}deg)
                      rotateY(${Math.cos(Date.now() / 4000) * 10}deg)
                      translateZ(10px)
                    `,
                                                            boxShadow: '0 10px 30px rgba(59, 130, 246, 0.3)'
                                                        }, children: _jsx(Headphones, { className: "h-6 w-6 text-white" }) }), _jsx("span", { className: "text-2xl font-bold text-white", children: "Heyloo" })] }), _jsx("p", { className: "text-gray-400 leading-relaxed", children: "The future of restaurant automation. AI that understands, processes, and delivers exceptional customer experiences." }), _jsx("div", { className: "flex gap-4", children: [
                                                    { icon: Phone, color: 'from-blue-500 to-indigo-600' },
                                                    { icon: Building2, color: 'from-purple-500 to-violet-600' },
                                                    { icon: BarChart3, color: 'from-green-500 to-emerald-600' }
                                                ].map((social, i) => (_jsx("button", { className: `w-12 h-12 bg-gradient-to-br ${social.color} rounded-xl flex items-center justify-center shadow-lg transition-all duration-300 hover:scale-110`, style: {
                                                        transform: `
                        translateZ(${5 + i * 2}px) 
                        rotateY(${Math.sin(Date.now() / (2500 + i * 300)) * 15}deg)
                      `
                                                    }, children: _jsx(social.icon, { className: "h-5 w-5 text-white" }) }, i))) })] }), _jsxs("div", { className: "space-y-6", style: {
                                            transform: `translateZ(15px) rotateY(${Math.cos(Date.now() / 9000) * 1}deg)`
                                        }, children: [_jsx("h3", { className: "text-white font-bold text-lg", children: "Product" }), _jsx("ul", { className: "space-y-3 text-gray-400", children: ['Voice AI Assistant', 'POS Integration', 'Analytics Dashboard', 'Multi-language Support'].map((item, i) => (_jsx("li", { className: "hover:text-white transition-colors cursor-pointer", style: {
                                                        transform: `translateX(${Math.sin(Date.now() / (3000 + i * 400)) * 2}px)`
                                                    }, children: item }, i))) })] }), _jsxs("div", { className: "space-y-6", style: {
                                            transform: `translateZ(10px) rotateY(${Math.sin(Date.now() / 7000) * 1}deg)`
                                        }, children: [_jsx("h3", { className: "text-white font-bold text-lg", children: "Resources" }), _jsx("ul", { className: "space-y-3 text-gray-400", children: ['Documentation', 'API Reference', 'Case Studies', 'Support Center'].map((item, i) => (_jsx("li", { className: "hover:text-white transition-colors cursor-pointer", style: {
                                                        transform: `translateX(${Math.cos(Date.now() / (3500 + i * 300)) * 2}px)`
                                                    }, children: item }, i))) })] }), _jsxs("div", { className: "space-y-6", style: {
                                            transform: `translateZ(5px) rotateY(${Math.cos(Date.now() / 6000) * 1}deg)`
                                        }, children: [_jsx("h3", { className: "text-white font-bold text-lg", children: "Contact" }), _jsxs("div", { className: "space-y-4 text-gray-400", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(Phone, { className: "h-5 w-5 text-blue-400" }), _jsx("span", { children: "+1 (555) 123-4567" })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx(Building2, { className: "h-5 w-5 text-purple-400" }), _jsx("span", { children: "hello@heyloo.com" })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx(Headphones, { className: "h-5 w-5 text-green-400" }), _jsx("span", { children: "24/7 Support" })] })] })] })] }), _jsxs("div", { className: "border-t border-white/10 mt-16 pt-8 flex flex-col md:flex-row items-center justify-between gap-6", children: [_jsx("div", { className: "text-gray-400 text-sm", children: "\u00A9 2024 Heyloo Technologies. All rights reserved." }), _jsxs("div", { className: "flex items-center gap-8 text-sm text-gray-400", children: [_jsx(Link, { to: "/privacy", className: "hover:text-white transition-colors", children: "Privacy Policy" }), _jsx("span", { children: "Terms of Service" }), _jsx("span", { children: "Cookie Policy" })] })] })] })] })] }));
}
export default LandingPage;
