import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Link } from 'react-router-dom';
import { useEffect, useRef, useState, Suspense, useMemo } from 'react';
import { ArrowRight, Zap, Shield, CheckCircle2, Star, Sparkles, TrendingUp, Headphones, Clock, Building2, Play, Menu, X, BarChart3, Mic } from 'lucide-react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Line } from '@react-three/drei';
import * as THREE from 'three';
// Premium 3D Scene - Apple/Stripe Style
function RestaurantScene() {
    const groupRef = useRef(null);
    useFrame((state) => {
        if (groupRef.current) {
            groupRef.current.rotation.y = state.clock.elapsedTime * 0.1;
        }
    });
    return (_jsxs("group", { ref: groupRef, children: [_jsx(ParticleField, {}), _jsx(HolographicPhone, {}), _jsx(DataOrb, { position: [-2.5, 0, -1], color: "#10b981", label: "Restaurant", delay: 0 }), _jsx(DataOrb, { position: [2.5, 0, -1], color: "#10b981", label: "Restaurant", delay: 0.3 }), _jsx(DataOrb, { position: [0, 2, -1], color: "#10b981", label: "Restaurant", delay: 0.6 }), _jsx(EnergyBeam, { start: [-2.5, 0, -1], end: [0, 0, 0], color: "#3b82f6", delay: 0 }), _jsx(EnergyBeam, { start: [2.5, 0, -1], end: [0, 0, 0], color: "#8b5cf6", delay: 0.5 }), _jsx(EnergyBeam, { start: [0, 2, -1], end: [0, 0, 0], color: "#ec4899", delay: 1 }), _jsx(FloatingDataPoints, {})] }));
}
// Particle field background
function ParticleField() {
    const particlesRef = useRef(null);
    const particles = useMemo(() => {
        const positions = new Float32Array(1000 * 3);
        for (let i = 0; i < 1000; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 15;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 15;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 15;
        }
        return positions;
    }, []);
    useFrame((state) => {
        if (particlesRef.current) {
            particlesRef.current.rotation.y = state.clock.elapsedTime * 0.02;
        }
    });
    return (_jsxs("points", { ref: particlesRef, children: [_jsx("bufferGeometry", { children: _jsx("bufferAttribute", { attach: "attributes-position", count: particles.length / 3, array: particles, itemSize: 3 }) }), _jsx("pointsMaterial", { size: 0.02, color: "#60a5fa", transparent: true, opacity: 0.6, sizeAttenuation: true })] }));
}
// Holographic phone with glassmorphism
function HolographicPhone() {
    const phoneRef = useRef(null);
    useFrame((state) => {
        if (phoneRef.current) {
            phoneRef.current.position.y = Math.sin(state.clock.elapsedTime) * 0.1;
            phoneRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.5) * 0.1;
        }
    });
    return (_jsxs("group", { ref: phoneRef, children: [_jsxs("mesh", { children: [_jsx("boxGeometry", { args: [1, 2, 0.1] }), _jsx("meshPhysicalMaterial", { color: "#1e40af", metalness: 0.1, roughness: 0.1, transmission: 0.9, thickness: 0.5, transparent: true, opacity: 0.3 })] }), _jsxs("mesh", { position: [0, 0, 0.06], children: [_jsx("planeGeometry", { args: [0.85, 1.8] }), _jsx("meshStandardMaterial", { color: "#60a5fa", emissive: "#3b82f6", emissiveIntensity: 2, transparent: true, opacity: 0.8 })] }), _jsx(MicWaves, {})] }));
}
// Mic waves animation
function MicWaves() {
    const wavesRef = useRef(null);
    useFrame((state) => {
        if (wavesRef.current) {
            wavesRef.current.children.forEach((child, i) => {
                const scale = 1 + Math.sin(state.clock.elapsedTime * 3 - i * 0.3) * 0.2;
                child.scale.set(scale, scale, 1);
            });
        }
    });
    return (_jsx("group", { ref: wavesRef, position: [0, 0, 0.12], children: [0.3, 0.45, 0.6].map((radius, i) => (_jsxs("mesh", { children: [_jsx("ringGeometry", { args: [radius, radius + 0.02, 32] }), _jsx("meshBasicMaterial", { color: ['#3b82f6', '#8b5cf6', '#ec4899'][i], transparent: true, opacity: 0.6 - i * 0.1 })] }, i))) }));
}
// Glassmorphic Data Orb (Restaurant)
function DataOrb({ position, color, label, delay }) {
    const orbRef = useRef(null);
    useFrame((state) => {
        if (orbRef.current) {
            orbRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 2 + delay) * 0.15;
            orbRef.current.rotation.y = state.clock.elapsedTime * 0.5;
        }
    });
    return (_jsxs("group", { ref: orbRef, position: position, children: [_jsxs("mesh", { children: [_jsx("sphereGeometry", { args: [0.5, 32, 32] }), _jsx("meshPhysicalMaterial", { color: color, metalness: 0.1, roughness: 0.05, transmission: 0.95, thickness: 0.8, transparent: true, opacity: 0.4 })] }), _jsxs("mesh", { scale: 0.6, children: [_jsx("sphereGeometry", { args: [0.5, 16, 16] }), _jsx("meshStandardMaterial", { color: color, emissive: color, emissiveIntensity: 3, transparent: true, opacity: 0.8 })] }), _jsxs("mesh", { rotation: [Math.PI / 2, 0, 0], children: [_jsx("torusGeometry", { args: [0.6, 0.02, 16, 64] }), _jsx("meshBasicMaterial", { color: color, transparent: true, opacity: 0.6 })] })] }));
}
// Energy Beam Connection
function EnergyBeam({ start, end, color, delay }) {
    const beamRef = useRef(null);
    useFrame((state) => {
        if (beamRef.current && beamRef.current.material) {
            const material = beamRef.current.material;
            material.opacity = 0.4 + Math.sin(state.clock.elapsedTime * 3 + delay) * 0.3;
        }
    });
    // Calculate beam direction and length
    const startVec = new THREE.Vector3(...start);
    const endVec = new THREE.Vector3(...end);
    const direction = new THREE.Vector3().subVectors(endVec, startVec);
    const length = direction.length();
    const midpoint = new THREE.Vector3().addVectors(startVec, endVec).multiplyScalar(0.5);
    // Calculate rotation
    const axis = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(axis, direction.clone().normalize());
    const euler = new THREE.Euler().setFromQuaternion(quaternion);
    return (_jsxs("mesh", { ref: beamRef, position: midpoint, rotation: euler, children: [_jsx("cylinderGeometry", { args: [0.02, 0.02, length, 8] }), _jsx("meshBasicMaterial", { color: color, transparent: true, opacity: 0.6 })] }));
}
// Floating Data Points Animation
function FloatingDataPoints() {
    const pointsRef = useRef(null);
    useFrame((state) => {
        if (pointsRef.current) {
            pointsRef.current.rotation.y = state.clock.elapsedTime * 0.2;
            pointsRef.current.children.forEach((child, i) => {
                child.position.y = Math.sin(state.clock.elapsedTime * 2 + i * 0.5) * 0.3;
            });
        }
    });
    const dataPoints = [
        { pos: [1.5, 0, 1.5], color: '#f59e0b' },
        { pos: [-1.5, 0, 1.5], color: '#ec4899' },
        { pos: [1.5, 0, -1.5], color: '#8b5cf6' },
        { pos: [-1.5, 0, -1.5], color: '#3b82f6' },
    ];
    return (_jsx("group", { ref: pointsRef, children: dataPoints.map((point, i) => (_jsxs("mesh", { position: point.pos, children: [_jsx("octahedronGeometry", { args: [0.15, 0] }), _jsx("meshStandardMaterial", { color: point.color, emissive: point.color, emissiveIntensity: 2, transparent: true, opacity: 0.8 })] }, i))) }));
}
// Voice waves component
function VoiceWaves() {
    const wavesRef = useRef(null);
    useFrame((state) => {
        if (wavesRef.current) {
            wavesRef.current.children.forEach((child, i) => {
                const scale = 1 + Math.sin(state.clock.elapsedTime * 2 - i * 0.5) * 0.3;
                child.scale.set(scale, scale, scale);
            });
        }
    });
    const waveRings = useMemo(() => {
        return [1.5, 2.0, 2.5, 3.0].map((radius, i) => {
            const points = Array.from({ length: 64 }, (_, j) => {
                const angle = (j / 64) * Math.PI * 2;
                return [Math.cos(angle) * radius, Math.sin(angle) * radius, 0];
            });
            return { points, color: ['#3b82f6', '#8b5cf6', '#ec4899', '#f97316'][i] };
        });
    }, []);
    return (_jsx("group", { ref: wavesRef, rotation: [0, 0, 0], children: waveRings.map((ring, i) => (_jsx(Line, { points: ring.points, color: ring.color, lineWidth: 3, transparent: true, opacity: 0.4 }, i))) }));
}
// Restaurant icon component - looks like a building with utensils
function RestaurantIcon({ position, rotation }) {
    const iconRef = useRef(null);
    useFrame((state) => {
        if (iconRef.current) {
            iconRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime + rotation) * 0.1;
        }
    });
    return (_jsxs("group", { ref: iconRef, position: position, rotation: [0, rotation, 0], children: [_jsxs("mesh", { position: [0, 0, 0], children: [_jsx("boxGeometry", { args: [1.2, 1.5, 1.2] }), _jsx("meshStandardMaterial", { color: "#10b981", emissive: "#10b981", emissiveIntensity: 0.4, metalness: 0.3, roughness: 0.7 })] }), _jsxs("mesh", { position: [0, 0.9, 0], children: [_jsx("coneGeometry", { args: [0.8, 0.5, 4] }), _jsx("meshStandardMaterial", { color: "#059669", emissive: "#059669", emissiveIntensity: 0.3 })] }), _jsxs("mesh", { position: [-0.2, 0.2, 0.62], children: [_jsx("cylinderGeometry", { args: [0.03, 0.03, 0.6, 8] }), _jsx("meshStandardMaterial", { color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 0.5 })] }), _jsxs("mesh", { position: [0.2, 0.2, 0.62], children: [_jsx("cylinderGeometry", { args: [0.03, 0.03, 0.6, 8] }), _jsx("meshStandardMaterial", { color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 0.5 })] }), _jsxs("mesh", { position: [0, 0, 0.61], children: [_jsx("boxGeometry", { args: [0.5, 0.5, 0.05] }), _jsx("meshStandardMaterial", { color: "#fbbf24", emissive: "#fbbf24", emissiveIntensity: 1.0 })] })] }));
}
// Animated call connection lines
function CallConnection({ start, end, delay }) {
    const lineRef = useRef(null);
    useFrame((state) => {
        if (lineRef.current) {
            const t = (Math.sin(state.clock.elapsedTime * 2 + delay) + 1) / 2;
            lineRef.current.material.opacity = 0.3 + t * 0.4;
        }
    });
    const points = useMemo(() => {
        const mid = [
            (start[0] + end[0]) / 2,
            (start[1] + end[1]) / 2 + 0.5,
            (start[2] + end[2]) / 2
        ];
        return [start, mid, end];
    }, [start, end]);
    return (_jsx(Line, { ref: lineRef, points: points, color: "#3b82f6", lineWidth: 2, transparent: true, dashed: true, dashScale: 1, dashSize: 0.2, gapSize: 0.1 }));
}
// Floating orders (pizza, burger icons)
function FloatingOrders() {
    const ordersRef = useRef(null);
    useFrame((state) => {
        if (ordersRef.current) {
            ordersRef.current.rotation.y = state.clock.elapsedTime * 0.5;
        }
    });
    const orders = useMemo(() => {
        return Array.from({ length: 8 }, (_, i) => {
            const angle = (i / 8) * Math.PI * 2;
            const radius = 4;
            return {
                position: [
                    Math.cos(angle) * radius,
                    Math.sin(i) * 0.3,
                    Math.sin(angle) * radius
                ],
                type: i % 2 === 0 ? 'pizza' : 'burger'
            };
        });
    }, []);
    return (_jsx("group", { ref: ordersRef, children: orders.map((order, i) => (_jsx(OrderIcon, { position: order.position, type: order.type, delay: i * 0.3 }, i))) }));
}
// Individual order icon
function OrderIcon({ position, type, delay }) {
    const meshRef = useRef(null);
    useFrame((state) => {
        if (meshRef.current) {
            meshRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 2 + delay) * 0.2;
            meshRef.current.rotation.y += 0.02;
        }
    });
    return (_jsx("mesh", { ref: meshRef, position: position, children: type === 'pizza' ? (_jsxs(_Fragment, { children: [_jsx("cylinderGeometry", { args: [0.25, 0.25, 0.05, 32] }), _jsx("meshStandardMaterial", { color: "#f59e0b", emissive: "#f59e0b", emissiveIntensity: 0.5 })] })) : (_jsxs(_Fragment, { children: [_jsx("boxGeometry", { args: [0.35, 0.25, 0.35] }), _jsx("meshStandardMaterial", { color: "#ef4444", emissive: "#ef4444", emissiveIntensity: 0.5 })] })) }));
}
// 3D Animated Cards Component
function Card3D({ children, className = '' }) {
    const ref = useRef(null);
    const [isHovering, setIsHovering] = useState(false);
    const [rotateX, setRotateX] = useState(0);
    const [rotateY, setRotateY] = useState(0);
    const handleMouseMove = (e) => {
        if (!ref.current)
            return;
        const rect = ref.current.getBoundingClientRect();
        const x = (e.clientY - rect.top) / rect.height - 0.5;
        const y = (e.clientX - rect.left) / rect.width - 0.5;
        setRotateX(x * 20);
        setRotateY(y * 20);
    };
    const handleMouseLeave = () => {
        setRotateX(0);
        setRotateY(0);
        setIsHovering(false);
    };
    return (_jsx("div", { ref: ref, className: `perspective transition-all duration-300 ${className}`, style: {
            transformStyle: 'preserve-3d',
            transform: `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`,
        }, onMouseMove: handleMouseMove, onMouseLeave: handleMouseLeave, onMouseEnter: () => setIsHovering(true), children: children }));
}
// Animated metrics counter
function Counter({ value, label }) {
    const [count, setCount] = useState(0);
    const targetRef = useRef(null);
    const hasAnimated = useRef(false);
    useEffect(() => {
        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting && !hasAnimated.current) {
                hasAnimated.current = true;
                let current = 0;
                const increment = value / 30;
                const timer = setInterval(() => {
                    current += increment;
                    if (current >= value) {
                        setCount(value);
                        clearInterval(timer);
                    }
                    else {
                        setCount(Math.floor(current));
                    }
                }, 30);
            }
        }, { threshold: 0.1 });
        if (targetRef.current) {
            observer.observe(targetRef.current);
        }
        return () => observer.disconnect();
    }, [value]);
    return (_jsxs("div", { ref: targetRef, className: "text-center", children: [_jsxs("div", { className: "text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-600 bg-clip-text text-transparent", children: [count, "+"] }), _jsx("p", { className: "text-gray-400 text-sm mt-2", children: label })] }));
}
// Voice Wave Animation
function VoiceWave() {
    const [waveHeight, setWaveHeight] = useState(Array(12).fill(0.3));
    useEffect(() => {
        const interval = setInterval(() => {
            setWaveHeight(Array.from({ length: 12 }, () => Math.random() * 0.8 + 0.2));
        }, 100);
        return () => clearInterval(interval);
    }, []);
    return (_jsx("div", { className: "flex items-center justify-center gap-1 h-12", children: waveHeight.map((height, i) => (_jsx("div", { className: "w-1 bg-gradient-to-t from-blue-500 to-purple-500 rounded-full transition-all duration-100", style: { height: `${height * 100}%` } }, i))) }));
}
// Scrolling Text Animation Component
function ScrollingText() {
    const [scrollX, setScrollX] = useState(0);
    useEffect(() => {
        let animationId;
        let x = 0;
        const animate = () => {
            x += 0.5;
            if (x > 100)
                x = 0;
            setScrollX(x);
            animationId = requestAnimationFrame(animate);
        };
        animationId = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(animationId);
    }, []);
    return (_jsx("div", { className: "relative overflow-hidden py-4 bg-gradient-to-r from-transparent via-blue-500/20 to-transparent", children: _jsx("div", { className: "flex gap-8 whitespace-nowrap", style: { transform: `translateX(-${scrollX}%)` }, children: Array(3)
                .fill(0)
                .map((_, i) => (_jsx("span", { className: "text-lg font-semibold text-transparent bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text", children: "\u2728 AI-Powered Voice Orders \u2022 Real-Time Analytics \u2022 Seamless Integrations \u2022 Premium Support" }, i))) }) }));
}
import { useScroll } from 'framer-motion';
export function LandingPage() {
    const containerRef = useRef(null);
    const { scrollYProgress } = useScroll({
        target: containerRef,
        offset: ["start start", "end end"]
    });
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [scrollY, setScrollY] = useState(0);
    useEffect(() => {
        const handleScroll = () => setScrollY(window.scrollY);
        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);
    return (_jsxs("div", { className: "relative min-h-screen bg-black text-white overflow-hidden", children: [_jsxs("div", { className: "fixed inset-0 -z-10 overflow-hidden", children: [_jsx("div", { className: "absolute inset-0 bg-gradient-to-br from-blue-900/30 via-black to-purple-900/30" }), _jsx("div", { className: "absolute top-0 left-1/4 w-96 h-96 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse" }), _jsx("div", { className: "absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse", style: { animationDelay: '2s' } }), _jsx("div", { className: "absolute top-1/2 left-1/2 w-96 h-96 bg-pink-500 rounded-full mix-blend-multiply filter blur-3xl opacity-15 animate-pulse", style: { animationDelay: '4s' } }), _jsx("div", { className: "absolute inset-0 opacity-10", style: {
                            backgroundImage: 'linear-gradient(rgba(59, 130, 246, 0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(59, 130, 246, 0.3) 1px, transparent 1px)',
                            backgroundSize: '100px 100px',
                            animation: 'gridMove 20s linear infinite'
                        } })] }), _jsxs("nav", { className: "fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-xl border-b border-white/10", children: [_jsxs("div", { className: "max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-2 font-bold text-2xl bg-gradient-to-r from-blue-400 to-purple-600 bg-clip-text text-transparent", children: [_jsx(Sparkles, { className: "w-6 h-6 text-blue-400" }), "Heyloo"] }), _jsxs("div", { className: "hidden md:flex items-center gap-8", children: [_jsx("a", { href: "#features", className: "hover:text-blue-400 transition-colors", children: "Features" }), _jsx("a", { href: "#benefits", className: "hover:text-blue-400 transition-colors", children: "Benefits" }), _jsx("a", { href: "#pricing", className: "hover:text-blue-400 transition-colors", children: "Pricing" })] }), _jsxs("div", { className: "hidden md:flex items-center gap-4", children: [_jsx(Link, { to: "/login", className: "px-6 py-2 text-white hover:text-blue-400 transition-colors", children: "Sign In" }), _jsx(Link, { to: "/onboarding", className: "px-6 py-2 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg font-semibold hover:shadow-lg hover:shadow-blue-500/50 transition-all", children: "Get Started" })] }), _jsx("button", { className: "md:hidden", onClick: () => setMobileMenuOpen(!mobileMenuOpen), children: mobileMenuOpen ? _jsx(X, {}) : _jsx(Menu, {}) })] }), mobileMenuOpen && (_jsx("div", { className: "md:hidden bg-black/95 border-t border-white/10 p-4", children: _jsxs("div", { className: "flex flex-col gap-4", children: [_jsx("a", { href: "#features", className: "hover:text-blue-400 transition-colors", children: "Features" }), _jsx("a", { href: "#benefits", className: "hover:text-blue-400 transition-colors", children: "Benefits" }), _jsx(Link, { to: "/login", className: "text-blue-400", children: "Sign In" }), _jsx(Link, { to: "/onboarding", className: "px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg text-center font-semibold", children: "Get Started" })] }) }))] }), _jsx("section", { className: "relative pt-32 pb-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto", children: _jsxs("div", { className: "grid lg:grid-cols-2 gap-12 items-center", children: [_jsx("div", { className: "relative z-10", children: _jsxs("div", { className: "space-y-6", children: [_jsxs("h1", { className: "text-5xl sm:text-6xl lg:text-7xl font-bold leading-tight", children: [_jsx("span", { className: "bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent", children: "AI Voice Agents" }), _jsx("br", {}), _jsx("span", { className: "text-white", children: "for Restaurants" })] }), _jsx("p", { className: "text-xl text-gray-300 max-w-lg leading-relaxed", children: "Transform customer calls into revenue. Our AI-powered voice agents handle orders, answer questions, and integrate seamlessly with your POS system." }), _jsxs("div", { className: "flex flex-col sm:flex-row gap-4", children: [_jsxs(Link, { to: "/onboarding", className: "group px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg font-semibold text-lg hover:shadow-xl hover:shadow-blue-500/50 transition-all flex items-center gap-2 justify-center sm:justify-start hover:scale-105 transform", children: ["Start Free Trial ", _jsx(ArrowRight, { className: "w-5 h-5 group-hover:translate-x-1 transition-transform" })] }), _jsxs("button", { className: "group px-8 py-4 border-2 border-white/30 rounded-lg font-semibold hover:bg-white/10 transition-all flex items-center gap-2 justify-center hover:scale-105 transform hover:border-blue-400", children: [_jsx(Play, { className: "w-5 h-5 group-hover:scale-110 transition-transform" }), " Watch Demo"] })] }), _jsx(VoiceWave, {}), _jsxs("div", { className: "flex flex-wrap gap-6 pt-4", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(CheckCircle2, { className: "w-5 h-5 text-green-400" }), _jsx("span", { className: "text-sm text-gray-300", children: "No credit card required" })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(CheckCircle2, { className: "w-5 h-5 text-green-400" }), _jsx("span", { className: "text-sm text-gray-300", children: "Setup in 5 minutes" })] })] })] }) }), _jsx("div", { className: "relative h-96 lg:h-[500px]", children: _jsxs(Canvas, { className: "w-full h-full", gl: { alpha: true, antialias: true }, children: [_jsx(PerspectiveCamera, { makeDefault: true, position: [0, 0, 6] }), _jsx("ambientLight", { intensity: 0.3 }), _jsx("pointLight", { position: [5, 5, 5], intensity: 2, color: "#60a5fa" }), _jsx("pointLight", { position: [-5, -5, -5], intensity: 1.5, color: "#a78bfa" }), _jsx("spotLight", { position: [0, 10, 0], intensity: 1, angle: 0.3, penumbra: 1, color: "#ec4899" }), _jsx(Suspense, { fallback: null, children: _jsx(RestaurantScene, {}) }), _jsx(OrbitControls, { enableZoom: false, enablePan: false, autoRotate: true, autoRotateSpeed: 0.5, minPolarAngle: Math.PI / 2.5, maxPolarAngle: Math.PI / 1.8 })] }) })] }) }), _jsx(ScrollingText, {}), _jsxs("section", { id: "features", className: "py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto", children: [_jsxs("div", { className: "text-center mb-16", children: [_jsx("h2", { className: "text-4xl sm:text-5xl font-bold mb-4", children: _jsx("span", { className: "bg-gradient-to-r from-blue-400 to-purple-600 bg-clip-text text-transparent", children: "Powerful Features" }) }), _jsx("p", { className: "text-xl text-gray-400 max-w-2xl mx-auto", children: "Everything you need to automate customer interactions and boost revenue" })] }), _jsxs("div", { className: "grid md:grid-cols-3 gap-8", children: [_jsx(Card3D, { className: "group", children: _jsxs("div", { className: "relative bg-gradient-to-br from-blue-900/40 to-purple-900/40 backdrop-blur-xl p-8 rounded-xl border border-white/10 hover:border-blue-500/50 transition-all h-full overflow-hidden", children: [_jsx("div", { className: "absolute inset-0 bg-gradient-to-br from-blue-500/0 to-purple-500/0 group-hover:from-blue-500/10 group-hover:to-purple-500/10 transition-all duration-500" }), _jsxs("div", { className: "relative z-10", children: [_jsx("div", { className: "w-12 h-12 bg-gradient-to-br from-blue-400 to-blue-600 rounded-lg flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-6 transition-all", children: _jsx(Mic, { className: "w-6 h-6" }) }), _jsx("h3", { className: "text-2xl font-bold mb-4 group-hover:text-blue-300 transition-colors", children: "Natural Voice AI" }), _jsx("p", { className: "text-gray-300", children: "Advanced AI understands natural language, handles complex requests, and provides human-like conversations." }), _jsxs("ul", { className: "mt-6 space-y-2", children: [_jsxs("li", { className: "flex items-center gap-2 text-sm text-gray-400", children: [_jsx(CheckCircle2, { className: "w-4 h-4 text-green-400" }), "Multi-language support"] }), _jsxs("li", { className: "flex items-center gap-2 text-sm text-gray-400", children: [_jsx(CheckCircle2, { className: "w-4 h-4 text-green-400" }), "Context awareness"] }), _jsxs("li", { className: "flex items-center gap-2 text-sm text-gray-400", children: [_jsx(CheckCircle2, { className: "w-4 h-4 text-green-400" }), "Custom training"] })] })] })] }) }), _jsx(Card3D, { className: "group", children: _jsxs("div", { className: "bg-gradient-to-br from-blue-900/40 to-purple-900/40 backdrop-blur-xl p-8 rounded-xl border border-white/10 hover:border-purple-500/50 transition-all h-full", children: [_jsx("div", { className: "w-12 h-12 bg-gradient-to-br from-purple-400 to-purple-600 rounded-lg flex items-center justify-center mb-6 group-hover:scale-110 transition-transform", children: _jsx(Zap, { className: "w-6 h-6" }) }), _jsx("h3", { className: "text-2xl font-bold mb-4", children: "Real-Time Integration" }), _jsx("p", { className: "text-gray-300", children: "Seamless integration with Square, Toast, Clover, and other POS systems for instant order processing." }), _jsxs("ul", { className: "mt-6 space-y-2", children: [_jsxs("li", { className: "flex items-center gap-2 text-sm text-gray-400", children: [_jsx(CheckCircle2, { className: "w-4 h-4 text-green-400" }), "Instant menu sync"] }), _jsxs("li", { className: "flex items-center gap-2 text-sm text-gray-400", children: [_jsx(CheckCircle2, { className: "w-4 h-4 text-green-400" }), "Auto-payment links"] }), _jsxs("li", { className: "flex items-center gap-2 text-sm text-gray-400", children: [_jsx(CheckCircle2, { className: "w-4 h-4 text-green-400" }), "Inventory sync"] })] })] }) }), _jsx(Card3D, { className: "group", children: _jsxs("div", { className: "bg-gradient-to-br from-blue-900/40 to-purple-900/40 backdrop-blur-xl p-8 rounded-xl border border-white/10 hover:border-pink-500/50 transition-all h-full", children: [_jsx("div", { className: "w-12 h-12 bg-gradient-to-br from-pink-400 to-pink-600 rounded-lg flex items-center justify-center mb-6 group-hover:scale-110 transition-transform", children: _jsx(BarChart3, { className: "w-6 h-6" }) }), _jsx("h3", { className: "text-2xl font-bold mb-4", children: "Advanced Analytics" }), _jsx("p", { className: "text-gray-300", children: "Real-time dashboards show call metrics, revenue impact, customer insights, and AI performance data." }), _jsxs("ul", { className: "mt-6 space-y-2", children: [_jsxs("li", { className: "flex items-center gap-2 text-sm text-gray-400", children: [_jsx(CheckCircle2, { className: "w-4 h-4 text-green-400" }), "Call analytics"] }), _jsxs("li", { className: "flex items-center gap-2 text-sm text-gray-400", children: [_jsx(CheckCircle2, { className: "w-4 h-4 text-green-400" }), "Revenue tracking"] }), _jsxs("li", { className: "flex items-center gap-2 text-sm text-gray-400", children: [_jsx(CheckCircle2, { className: "w-4 h-4 text-green-400" }), "KPI dashboards"] })] })] }) }), _jsx(Card3D, { className: "group", children: _jsxs("div", { className: "bg-gradient-to-br from-blue-900/40 to-purple-900/40 backdrop-blur-xl p-8 rounded-xl border border-white/10 hover:border-blue-500/50 transition-all h-full", children: [_jsx("div", { className: "w-12 h-12 bg-gradient-to-br from-blue-400 to-blue-600 rounded-lg flex items-center justify-center mb-6 group-hover:scale-110 transition-transform", children: _jsx(Shield, { className: "w-6 h-6" }) }), _jsx("h3", { className: "text-2xl font-bold mb-4", children: "Enterprise Security" }), _jsx("p", { className: "text-gray-300", children: "Bank-grade encryption, PCI compliance, automatic backups, and 24/7 monitoring for peace of mind." }), _jsxs("ul", { className: "mt-6 space-y-2", children: [_jsxs("li", { className: "flex items-center gap-2 text-sm text-gray-400", children: [_jsx(CheckCircle2, { className: "w-4 h-4 text-green-400" }), "ISO 27001 certified"] }), _jsxs("li", { className: "flex items-center gap-2 text-sm text-gray-400", children: [_jsx(CheckCircle2, { className: "w-4 h-4 text-green-400" }), "PCI-DSS compliant"] }), _jsxs("li", { className: "flex items-center gap-2 text-sm text-gray-400", children: [_jsx(CheckCircle2, { className: "w-4 h-4 text-green-400" }), "99.9% uptime SLA"] })] })] }) }), _jsx(Card3D, { className: "group", children: _jsxs("div", { className: "bg-gradient-to-br from-blue-900/40 to-purple-900/40 backdrop-blur-xl p-8 rounded-xl border border-white/10 hover:border-purple-500/50 transition-all h-full", children: [_jsx("div", { className: "w-12 h-12 bg-gradient-to-br from-purple-400 to-purple-600 rounded-lg flex items-center justify-center mb-6 group-hover:scale-110 transition-transform", children: _jsx(Headphones, { className: "w-6 h-6" }) }), _jsx("h3", { className: "text-2xl font-bold mb-4", children: "Premium Support" }), _jsx("p", { className: "text-gray-300", children: "Dedicated account managers, priority support, custom training, and ongoing optimization for your team." }), _jsxs("ul", { className: "mt-6 space-y-2", children: [_jsxs("li", { className: "flex items-center gap-2 text-sm text-gray-400", children: [_jsx(CheckCircle2, { className: "w-4 h-4 text-green-400" }), "24/7 support"] }), _jsxs("li", { className: "flex items-center gap-2 text-sm text-gray-400", children: [_jsx(CheckCircle2, { className: "w-4 h-4 text-green-400" }), "Phone & email"] }), _jsxs("li", { className: "flex items-center gap-2 text-sm text-gray-400", children: [_jsx(CheckCircle2, { className: "w-4 h-4 text-green-400" }), "Custom integrations"] })] })] }) }), _jsx(Card3D, { className: "group", children: _jsxs("div", { className: "bg-gradient-to-br from-blue-900/40 to-purple-900/40 backdrop-blur-xl p-8 rounded-xl border border-white/10 hover:border-pink-500/50 transition-all h-full", children: [_jsx("div", { className: "w-12 h-12 bg-gradient-to-br from-pink-400 to-pink-600 rounded-lg flex items-center justify-center mb-6 group-hover:scale-110 transition-transform", children: _jsx(TrendingUp, { className: "w-6 h-6" }) }), _jsx("h3", { className: "text-2xl font-bold mb-4", children: "Revenue Growth" }), _jsx("p", { className: "text-gray-300", children: "Increase order volume by 40%, reduce response times, and improve customer satisfaction with intelligent automation." }), _jsxs("ul", { className: "mt-6 space-y-2", children: [_jsxs("li", { className: "flex items-center gap-2 text-sm text-gray-400", children: [_jsx(CheckCircle2, { className: "w-4 h-4 text-green-400" }), "+40% orders"] }), _jsxs("li", { className: "flex items-center gap-2 text-sm text-gray-400", children: [_jsx(CheckCircle2, { className: "w-4 h-4 text-green-400" }), "-60% wait time"] }), _jsxs("li", { className: "flex items-center gap-2 text-sm text-gray-400", children: [_jsx(CheckCircle2, { className: "w-4 h-4 text-green-400" }), "+35% satisfaction"] })] })] }) })] })] }), _jsxs("section", { id: "benefits", className: "py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto", children: [_jsx("div", { className: "text-center mb-16", children: _jsx("h2", { className: "text-4xl sm:text-5xl font-bold mb-4", children: _jsx("span", { className: "bg-gradient-to-r from-blue-400 to-purple-600 bg-clip-text text-transparent", children: "Why Restaurants Love Heyloo" }) }) }), _jsxs("div", { className: "grid md:grid-cols-2 gap-12 items-center", children: [_jsx("div", { className: "space-y-8", children: [
                                    {
                                        icon: _jsx(Zap, { className: "w-8 h-8" }),
                                        title: 'Instant Setup',
                                        description: 'Get your AI agent live in just 5 minutes. No complex configuration needed.'
                                    },
                                    {
                                        icon: _jsx(Building2, { className: "w-8 h-8" }),
                                        title: 'Works with Any POS',
                                        description: 'Integrates seamlessly with Square, Toast, Clover, and 50+ other systems.'
                                    },
                                    {
                                        icon: _jsx(Clock, { className: "w-8 h-8" }),
                                        title: '24/7 Availability',
                                        description: 'Handle calls 24/7 without hiring additional staff or overtime costs.'
                                    },
                                    {
                                        icon: _jsx(TrendingUp, { className: "w-8 h-8" }),
                                        title: 'Proven ROI',
                                        description: 'See measurable results within the first week. Average 3-6x ROI in year one.'
                                    }
                                ].map((item, i) => (_jsxs("div", { className: "flex gap-6 group", children: [_jsx("div", { className: "w-16 h-16 min-w-16 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-lg flex items-center justify-center text-blue-400 group-hover:text-purple-400 group-hover:scale-110 transition-all", children: item.icon }), _jsxs("div", { children: [_jsx("h3", { className: "text-xl font-bold mb-2 group-hover:text-blue-300 transition-colors", children: item.title }), _jsx("p", { className: "text-gray-400", children: item.description })] })] }, i))) }), _jsxs("div", { className: "space-y-8", children: [_jsxs("div", { className: "bg-gradient-to-br from-blue-900/30 to-purple-900/30 backdrop-blur-xl rounded-xl p-12 border border-white/10", children: [_jsxs("div", { className: "grid grid-cols-2 gap-8 mb-8", children: [_jsx(Counter, { value: 500, label: "Active Restaurants" }), _jsx(Counter, { value: 50000, label: "Calls/Month" })] }), _jsxs("div", { className: "grid grid-cols-2 gap-8", children: [_jsx(Counter, { value: 8, label: "Million$ Generated" }), _jsx(Counter, { value: 98, label: "Uptime %" })] })] }), _jsx("div", { className: "bg-gradient-to-br from-blue-900/20 to-purple-900/20 backdrop-blur-xl rounded-xl p-8 border border-white/10", children: _jsxs("div", { className: "flex items-start gap-4 mb-6", children: [_jsx(Star, { className: "w-6 h-6 text-yellow-400 mt-1" }), _jsxs("div", { children: [_jsx("p", { className: "text-lg font-semibold", children: "\"Heyloo transformed how we handle orders. We're processing 40% more calls with the same staff.\"" }), _jsx("p", { className: "text-gray-400 text-sm mt-2", children: "- Marco D., Restaurant Owner" })] })] }) })] })] })] }), _jsx("section", { className: "py-20 px-4 sm:px-6 lg:px-8", children: _jsx("div", { className: "max-w-4xl mx-auto", children: _jsxs("div", { className: "bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl p-12 text-center relative overflow-hidden", children: [_jsxs("div", { className: "absolute inset-0 opacity-30", children: [_jsx("div", { className: "absolute top-0 left-1/4 w-40 h-40 bg-white rounded-full mix-blend-multiply filter blur-3xl animate-pulse" }), _jsx("div", { className: "absolute bottom-0 right-1/4 w-40 h-40 bg-white rounded-full mix-blend-multiply filter blur-3xl animate-pulse", style: { animationDelay: '2s' } })] }), _jsxs("div", { className: "relative z-10", children: [_jsx("h2", { className: "text-4xl sm:text-5xl font-bold mb-6", children: "Ready to Transform Your Restaurant?" }), _jsx("p", { className: "text-xl opacity-90 mb-8 max-w-2xl mx-auto", children: "Join hundreds of restaurants already using Heyloo to automate orders and boost revenue." }), _jsxs("div", { className: "flex flex-col sm:flex-row gap-4 justify-center", children: [_jsxs(Link, { to: "/onboarding", className: "px-10 py-4 bg-white text-purple-600 rounded-lg font-bold text-lg hover:shadow-xl transition-all flex items-center gap-2 justify-center sm:justify-start", children: ["Start Free Trial (No Card Required) ", _jsx(ArrowRight, { className: "w-5 h-5" })] }), _jsx("button", { className: "px-10 py-4 border-2 border-white rounded-lg font-bold text-lg hover:bg-white/10 transition-all", children: "Schedule Demo" })] })] })] }) }) }), _jsx("footer", { className: "border-t border-white/10 py-12 px-4 sm:px-6 lg:px-8", children: _jsxs("div", { className: "max-w-7xl mx-auto", children: [_jsxs("div", { className: "grid md:grid-cols-4 gap-8 mb-8", children: [_jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-2 font-bold text-lg bg-gradient-to-r from-blue-400 to-purple-600 bg-clip-text text-transparent mb-4", children: [_jsx(Sparkles, { className: "w-5 h-5 text-blue-400" }), "Heyloo"] }), _jsx("p", { className: "text-gray-400 text-sm", children: "AI voice agents for modern restaurants" })] }), _jsxs("div", { children: [_jsx("h4", { className: "font-bold mb-4", children: "Product" }), _jsxs("ul", { className: "space-y-2 text-gray-400 text-sm", children: [_jsx("li", { children: _jsx("a", { href: "#features", className: "hover:text-white transition", children: "Features" }) }), _jsx("li", { children: _jsx("a", { href: "#", className: "hover:text-white transition", children: "Pricing" }) }), _jsx("li", { children: _jsx("a", { href: "#", className: "hover:text-white transition", children: "Security" }) })] })] }), _jsxs("div", { children: [_jsx("h4", { className: "font-bold mb-4", children: "Company" }), _jsxs("ul", { className: "space-y-2 text-gray-400 text-sm", children: [_jsx("li", { children: _jsx("a", { href: "#", className: "hover:text-white transition", children: "About" }) }), _jsx("li", { children: _jsx("a", { href: "#", className: "hover:text-white transition", children: "Blog" }) }), _jsx("li", { children: _jsx("a", { href: "#", className: "hover:text-white transition", children: "Contact" }) })] })] }), _jsxs("div", { children: [_jsx("h4", { className: "font-bold mb-4", children: "Legal" }), _jsxs("ul", { className: "space-y-2 text-gray-400 text-sm", children: [_jsx("li", { children: _jsx("a", { href: "/privacy", className: "hover:text-white transition", children: "Privacy" }) }), _jsx("li", { children: _jsx("a", { href: "/terms", className: "hover:text-white transition", children: "Terms" }) })] })] })] }), _jsxs("div", { className: "border-t border-white/10 pt-8 flex flex-col md:flex-row items-center justify-between", children: [_jsx("p", { className: "text-gray-400 text-sm", children: "\u00A9 2025 Heyloo. All rights reserved." }), _jsxs("div", { className: "flex gap-4 mt-4 md:mt-0", children: [_jsx("a", { href: "#", className: "text-gray-400 hover:text-white transition", children: "Twitter" }), _jsx("a", { href: "#", className: "text-gray-400 hover:text-white transition", children: "LinkedIn" }), _jsx("a", { href: "#", className: "text-gray-400 hover:text-white transition", children: "GitHub" })] })] })] }) })] }));
}
