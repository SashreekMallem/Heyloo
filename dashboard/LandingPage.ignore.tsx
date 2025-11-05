import { Link } from 'react-router-dom';
import { useEffect, useRef, useState, Suspense, useMemo } from 'react';
import {
  ArrowRight,
  Phone,
  Zap,
  Shield,
  CheckCircle2,
  Star,
  Sparkles,
  TrendingUp,
  Headphones,
  Clock,
  Building2,
  Play,
  Menu,
  X,
  BarChart3,
  Mic
} from 'lucide-react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Line } from '@react-three/drei';
import * as THREE from 'three';

// Premium 3D Scene - Apple/Stripe Style
function RestaurantScene() {
  const groupRef = useRef<THREE.Group>(null);
  
  useFrame((state: any) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = state.clock.elapsedTime * 0.1;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Particle Field Background */}
      <ParticleField />
      
      {/* Central Holographic Display */}
      <HolographicPhone />
      
      {/* Data Orbs (representing restaurants) */}
      <DataOrb position={[-2.5, 0, -1]} color="#10b981" label="Restaurant" delay={0} />
      <DataOrb position={[2.5, 0, -1]} color="#10b981" label="Restaurant" delay={0.3} />
      <DataOrb position={[0, 2, -1]} color="#10b981" label="Restaurant" delay={0.6} />
      
      {/* Connecting Energy Beams */}
      <EnergyBeam start={[-2.5, 0, -1]} end={[0, 0, 0]} color="#3b82f6" delay={0} />
      <EnergyBeam start={[2.5, 0, -1]} end={[0, 0, 0]} color="#8b5cf6" delay={0.5} />
      <EnergyBeam start={[0, 2, -1]} end={[0, 0, 0]} color="#ec4899" delay={1} />
      
      {/* Floating Data Points */}
      <FloatingDataPoints />
    </group>
  );
}

// Particle field background
function ParticleField() {
  const particlesRef = useRef<THREE.Points>(null);
  
  const particles = useMemo(() => {
    const positions = new Float32Array(1000 * 3);
    for (let i = 0; i < 1000; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 15;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 15;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 15;
    }
    return positions;
  }, []);
  
  useFrame((state: any) => {
    if (particlesRef.current) {
      particlesRef.current.rotation.y = state.clock.elapsedTime * 0.02;
    }
  });
  
  return (
    <points ref={particlesRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={particles.length / 3}
          array={particles}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.02}
        color="#60a5fa"
        transparent
        opacity={0.6}
        sizeAttenuation
      />
    </points>
  );
}

// Holographic phone with glassmorphism
function HolographicPhone() {
  const phoneRef = useRef<THREE.Group>(null);
  
  useFrame((state: any) => {
    if (phoneRef.current) {
      phoneRef.current.position.y = Math.sin(state.clock.elapsedTime) * 0.1;
      phoneRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.5) * 0.1;
    }
  });
  
  return (
    <group ref={phoneRef}>
      {/* Glass phone body */}
      <mesh>
        <boxGeometry args={[1, 2, 0.1]} />
        <meshPhysicalMaterial
          color="#1e40af"
          metalness={0.1}
          roughness={0.1}
          transmission={0.9}
          thickness={0.5}
          transparent
          opacity={0.3}
        />
      </mesh>
      
      {/* Holographic screen */}
      <mesh position={[0, 0, 0.06]}>
        <planeGeometry args={[0.85, 1.8]} />
        <meshStandardMaterial
          color="#60a5fa"
          emissive="#3b82f6"
          emissiveIntensity={2}
          transparent
          opacity={0.8}
        />
      </mesh>
      
      {/* Animated mic waves */}
      <MicWaves />
    </group>
  );
}

// Mic waves animation
function MicWaves() {
  const wavesRef = useRef<THREE.Group>(null);
  
  useFrame((state: any) => {
    if (wavesRef.current) {
      wavesRef.current.children.forEach((child, i) => {
        const scale = 1 + Math.sin(state.clock.elapsedTime * 3 - i * 0.3) * 0.2;
        child.scale.set(scale, scale, 1);
      });
    }
  });
  
  return (
    <group ref={wavesRef} position={[0, 0, 0.12]}>
      {[0.3, 0.45, 0.6].map((radius, i) => (
        <mesh key={i}>
          <ringGeometry args={[radius, radius + 0.02, 32]} />
          <meshBasicMaterial
            color={['#3b82f6', '#8b5cf6', '#ec4899'][i]}
            transparent
            opacity={0.6 - i * 0.1}
          />
        </mesh>
      ))}
    </group>
  );
}

// Glassmorphic Data Orb (Restaurant)
function DataOrb({ position, color, label, delay }: { position: [number, number, number]; color: string; label: string; delay: number }) {
  const orbRef = useRef<THREE.Group>(null);
  
  useFrame((state: any) => {
    if (orbRef.current) {
      orbRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 2 + delay) * 0.15;
      orbRef.current.rotation.y = state.clock.elapsedTime * 0.5;
    }
  });
  
  return (
    <group ref={orbRef} position={position}>
      {/* Glass sphere */}
      <mesh>
        <sphereGeometry args={[0.5, 32, 32]} />
        <meshPhysicalMaterial
          color={color}
          metalness={0.1}
          roughness={0.05}
          transmission={0.95}
          thickness={0.8}
          transparent
          opacity={0.4}
        />
      </mesh>
      
      {/* Inner glow core */}
      <mesh scale={0.6}>
        <sphereGeometry args={[0.5, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={3}
          transparent
          opacity={0.8}
        />
      </mesh>
      
      {/* Ring decoration */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.6, 0.02, 16, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.6} />
      </mesh>
    </group>
  );
}

// Energy Beam Connection
function EnergyBeam({ start, end, color, delay }: { start: [number, number, number]; end: [number, number, number]; color: string; delay: number }) {
  const beamRef = useRef<THREE.Mesh>(null);
  
  useFrame((state: any) => {
    if (beamRef.current && beamRef.current.material) {
      const material = beamRef.current.material as THREE.MeshBasicMaterial;
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
  
  return (
    <mesh ref={beamRef} position={midpoint} rotation={euler}>
      <cylinderGeometry args={[0.02, 0.02, length, 8]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.6}
      />
    </mesh>
  );
}

// Floating Data Points Animation
function FloatingDataPoints() {
  const pointsRef = useRef<THREE.Group>(null);
  
  useFrame((state: any) => {
    if (pointsRef.current) {
      pointsRef.current.rotation.y = state.clock.elapsedTime * 0.2;
      pointsRef.current.children.forEach((child, i) => {
        child.position.y = Math.sin(state.clock.elapsedTime * 2 + i * 0.5) * 0.3;
      });
    }
  });
  
  const dataPoints = [
    { pos: [1.5, 0, 1.5] as [number, number, number], color: '#f59e0b' },
    { pos: [-1.5, 0, 1.5] as [number, number, number], color: '#ec4899' },
    { pos: [1.5, 0, -1.5] as [number, number, number], color: '#8b5cf6' },
    { pos: [-1.5, 0, -1.5] as [number, number, number], color: '#3b82f6' },
  ];
  
  return (
    <group ref={pointsRef}>
      {dataPoints.map((point, i) => (
        <mesh key={i} position={point.pos}>
          <octahedronGeometry args={[0.15, 0]} />
          <meshStandardMaterial
            color={point.color}
            emissive={point.color}
            emissiveIntensity={2}
            transparent
            opacity={0.8}
          />
        </mesh>
      ))}
    </group>
  );
}

// Voice waves component
function VoiceWaves() {
  const wavesRef = useRef<THREE.Group>(null);
  
  useFrame((state: any) => {
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
        return [Math.cos(angle) * radius, Math.sin(angle) * radius, 0] as [number, number, number];
      });
      return { points, color: ['#3b82f6', '#8b5cf6', '#ec4899', '#f97316'][i] };
    });
  }, []);

  return (
    <group ref={wavesRef} rotation={[0, 0, 0]}>
      {waveRings.map((ring, i) => (
        <Line 
          key={i}
          points={ring.points}
          color={ring.color}
          lineWidth={3}
          transparent
          opacity={0.4}
        />
      ))}
    </group>
  );
}

// Restaurant icon component - looks like a building with utensils
function RestaurantIcon({ position, rotation }: { position: [number, number, number], rotation: number }) {
  const iconRef = useRef<THREE.Group>(null);
  
  useFrame((state: any) => {
    if (iconRef.current) {
      iconRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime + rotation) * 0.1;
    }
  });

  return (
    <group ref={iconRef} position={position} rotation={[0, rotation, 0]}>
      {/* Building base */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[1.2, 1.5, 1.2]} />
        <meshStandardMaterial 
          color="#10b981"
          emissive="#10b981"
          emissiveIntensity={0.4}
          metalness={0.3}
          roughness={0.7}
        />
      </mesh>

      {/* Roof */}
      <mesh position={[0, 0.9, 0]}>
        <coneGeometry args={[0.8, 0.5, 4]} />
        <meshStandardMaterial 
          color="#059669"
          emissive="#059669"
          emissiveIntensity={0.3}
        />
      </mesh>

      {/* Fork symbol */}
      <mesh position={[-0.2, 0.2, 0.62]}>
        <cylinderGeometry args={[0.03, 0.03, 0.6, 8]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.5} />
      </mesh>

      {/* Knife symbol */}
      <mesh position={[0.2, 0.2, 0.62]}>
        <cylinderGeometry args={[0.03, 0.03, 0.6, 8]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.5} />
      </mesh>

      {/* Window glow */}
      <mesh position={[0, 0, 0.61]}>
        <boxGeometry args={[0.5, 0.5, 0.05]} />
        <meshStandardMaterial 
          color="#fbbf24"
          emissive="#fbbf24"
          emissiveIntensity={1.0}
        />
      </mesh>
    </group>
  );
}

// Animated call connection lines
function CallConnection({ start, end, delay }: { start: [number, number, number], end: [number, number, number], delay: number }) {
  const lineRef = useRef<any>(null);
  
  useFrame((state: any) => {
    if (lineRef.current) {
      const t = (Math.sin(state.clock.elapsedTime * 2 + delay) + 1) / 2;
      lineRef.current.material.opacity = 0.3 + t * 0.4;
    }
  });

  const points = useMemo(() => {
    const mid: [number, number, number] = [
      (start[0] + end[0]) / 2,
      (start[1] + end[1]) / 2 + 0.5,
      (start[2] + end[2]) / 2
    ];
    return [start, mid, end];
  }, [start, end]);

  return (
    <Line 
      ref={lineRef}
      points={points}
      color="#3b82f6"
      lineWidth={2}
      transparent
      dashed
      dashScale={1}
      dashSize={0.2}
      gapSize={0.1}
    />
  );
}

// Floating orders (pizza, burger icons)
function FloatingOrders() {
  const ordersRef = useRef<THREE.Group>(null);
  
  useFrame((state: any) => {
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
        ] as [number, number, number],
        type: i % 2 === 0 ? 'pizza' : 'burger'
      };
    });
  }, []);

  return (
    <group ref={ordersRef}>
      {orders.map((order, i) => (
        <OrderIcon key={i} position={order.position} type={order.type} delay={i * 0.3} />
      ))}
    </group>
  );
}

// Individual order icon
function OrderIcon({ position, type, delay }: { position: [number, number, number], type: string, delay: number }) {
  const meshRef = useRef<THREE.Mesh>(null);
  
  useFrame((state: any) => {
    if (meshRef.current) {
      meshRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 2 + delay) * 0.2;
      meshRef.current.rotation.y += 0.02;
    }
  });

  return (
    <mesh ref={meshRef} position={position}>
      {type === 'pizza' ? (
        <>
          <cylinderGeometry args={[0.25, 0.25, 0.05, 32]} />
          <meshStandardMaterial 
            color="#f59e0b"
            emissive="#f59e0b"
            emissiveIntensity={0.5}
          />
        </>
      ) : (
        <>
          <boxGeometry args={[0.35, 0.25, 0.35]} />
          <meshStandardMaterial 
            color="#ef4444"
            emissive="#ef4444"
            emissiveIntensity={0.5}
          />
        </>
      )}
    </mesh>
  );
}

// 3D Animated Cards Component
function Card3D({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [rotateX, setRotateX] = useState(0);
  const [rotateY, setRotateY] = useState(0);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!ref.current) return;
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

  return (
    <div
      ref={ref}
      className={`perspective transition-all duration-300 ${className}`}
      style={{
        transformStyle: 'preserve-3d',
        transform: `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`,
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onMouseEnter={() => setIsHovering(true)}
    >
      {children}
    </div>
  );
}

// Animated metrics counter
function Counter({ value, label }: { value: number; label: string }) {
  const [count, setCount] = useState(0);
  const targetRef = useRef<HTMLDivElement>(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated.current) {
          hasAnimated.current = true;
          let current = 0;
          const increment = value / 30;
          const timer = setInterval(() => {
            current += increment;
            if (current >= value) {
              setCount(value);
              clearInterval(timer);
            } else {
              setCount(Math.floor(current));
            }
          }, 30);
        }
      },
      { threshold: 0.1 }
    );

    if (targetRef.current) {
      observer.observe(targetRef.current);
    }

    return () => observer.disconnect();
  }, [value]);

  return (
    <div ref={targetRef} className="text-center">
      <div className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-600 bg-clip-text text-transparent">
        {count}+
      </div>
      <p className="text-gray-400 text-sm mt-2">{label}</p>
    </div>
  );
}

// Voice Wave Animation
function VoiceWave() {
  const [waveHeight, setWaveHeight] = useState<number[]>(Array(12).fill(0.3));

  useEffect(() => {
    const interval = setInterval(() => {
      setWaveHeight(Array.from({ length: 12 }, () => Math.random() * 0.8 + 0.2));
    }, 100);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center justify-center gap-1 h-12">
      {waveHeight.map((height, i) => (
        <div
          key={i}
          className="w-1 bg-gradient-to-t from-blue-500 to-purple-500 rounded-full transition-all duration-100"
          style={{ height: `${height * 100}%` }}
        />
      ))}
    </div>
  );
}

// Scrolling Text Animation Component
function ScrollingText() {
  const [scrollX, setScrollX] = useState(0);

  useEffect(() => {
    let animationId: number;
    let x = 0;

    const animate = () => {
      x += 0.5;
      if (x > 100) x = 0;
      setScrollX(x);
      animationId = requestAnimationFrame(animate);
    };

    animationId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationId);
  }, []);

  return (
    <div className="relative overflow-hidden py-4 bg-gradient-to-r from-transparent via-blue-500/20 to-transparent">
      <div className="flex gap-8 whitespace-nowrap" style={{ transform: `translateX(-${scrollX}%)` }}>
        {Array(3)
          .fill(0)
          .map((_, i) => (
            <span key={i} className="text-lg font-semibold text-transparent bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text">
              ✨ AI-Powered Voice Orders • Real-Time Analytics • Seamless Integrations • Premium Support
            </span>
          ))}
      </div>
    </div>
  );
}

// Main Landing Page Component
import React, { useRef, useEffect } from 'react';
import { Phone, MessageSquare, TrendingUp, Users, ArrowRight, Check, Zap, BarChart3, Clock, Sparkles, Bot, Headphones } from 'lucide-react';
import { motion, useScroll, useTransform, useInView } from 'framer-motion';

export function LandingPage() {
  const containerRef = useRef<HTMLDivElement>(null);
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

  return (
    <div className="relative min-h-screen bg-black text-white overflow-hidden">
      {/* Animated background with multiple moving gradients */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-900/30 via-black to-purple-900/30" />
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse" style={{ animationDelay: '2s' }} />
        <div className="absolute top-1/2 left-1/2 w-96 h-96 bg-pink-500 rounded-full mix-blend-multiply filter blur-3xl opacity-15 animate-pulse" style={{ animationDelay: '4s' }} />
        
        {/* Animated grid overlay */}
        <div className="absolute inset-0 opacity-10" style={{
          backgroundImage: 'linear-gradient(rgba(59, 130, 246, 0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(59, 130, 246, 0.3) 1px, transparent 1px)',
          backgroundSize: '100px 100px',
          animation: 'gridMove 20s linear infinite'
        }} />
      </div>

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-2xl bg-gradient-to-r from-blue-400 to-purple-600 bg-clip-text text-transparent">
            <Sparkles className="w-6 h-6 text-blue-400" />
            Heyloo
          </div>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="hover:text-blue-400 transition-colors">
              Features
            </a>
            <a href="#benefits" className="hover:text-blue-400 transition-colors">
              Benefits
            </a>
            <a href="#pricing" className="hover:text-blue-400 transition-colors">
              Pricing
            </a>
          </div>

          <div className="hidden md:flex items-center gap-4">
            <Link to="/login" className="px-6 py-2 text-white hover:text-blue-400 transition-colors">
              Sign In
            </Link>
            <Link
              to="/onboarding"
              className="px-6 py-2 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg font-semibold hover:shadow-lg hover:shadow-blue-500/50 transition-all"
            >
              Get Started
            </Link>
          </div>

          {/* Mobile menu button */}
          <button className="md:hidden" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            {mobileMenuOpen ? <X /> : <Menu />}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-black/95 border-t border-white/10 p-4">
            <div className="flex flex-col gap-4">
              <a href="#features" className="hover:text-blue-400 transition-colors">
                Features
              </a>
              <a href="#benefits" className="hover:text-blue-400 transition-colors">
                Benefits
              </a>
              <Link to="/login" className="text-blue-400">
                Sign In
              </Link>
              <Link to="/onboarding" className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg text-center font-semibold">
                Get Started
              </Link>
            </div>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left content */}
          <div className="relative z-10">
            <div className="space-y-6">
              <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold leading-tight">
                <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">AI Voice Agents</span>
                <br />
                <span className="text-white">for Restaurants</span>
              </h1>

              <p className="text-xl text-gray-300 max-w-lg leading-relaxed">
                Transform customer calls into revenue. Our AI-powered voice agents handle orders, answer questions, and integrate seamlessly with your POS system.
              </p>

              <div className="flex flex-col sm:flex-row gap-4">
                <Link
                  to="/onboarding"
                  className="group px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg font-semibold text-lg hover:shadow-xl hover:shadow-blue-500/50 transition-all flex items-center gap-2 justify-center sm:justify-start hover:scale-105 transform"
                >
                  Start Free Trial <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </Link>
                <button className="group px-8 py-4 border-2 border-white/30 rounded-lg font-semibold hover:bg-white/10 transition-all flex items-center gap-2 justify-center hover:scale-105 transform hover:border-blue-400">
                  <Play className="w-5 h-5 group-hover:scale-110 transition-transform" /> Watch Demo
                </button>
              </div>

              <VoiceWave />

              {/* Trust badges */}
              <div className="flex flex-wrap gap-6 pt-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-400" />
                  <span className="text-sm text-gray-300">No credit card required</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-400" />
                  <span className="text-sm text-gray-300">Setup in 5 minutes</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right 3D Scene - Premium Design */}
          <div className="relative h-96 lg:h-[500px]">
            <Canvas className="w-full h-full" gl={{ alpha: true, antialias: true }}>
              <PerspectiveCamera makeDefault position={[0, 0, 6]} />
              <ambientLight intensity={0.3} />
              <pointLight position={[5, 5, 5]} intensity={2} color="#60a5fa" />
              <pointLight position={[-5, -5, -5]} intensity={1.5} color="#a78bfa" />
              <spotLight position={[0, 10, 0]} intensity={1} angle={0.3} penumbra={1} color="#ec4899" />
              <Suspense fallback={null}>
                <RestaurantScene />
              </Suspense>
              <OrbitControls 
                enableZoom={false} 
                enablePan={false} 
                autoRotate 
                autoRotateSpeed={0.5}
                minPolarAngle={Math.PI / 2.5}
                maxPolarAngle={Math.PI / 1.8}
              />
            </Canvas>
          </div>
        </div>
      </section>

      {/* Scrolling Text Section */}
      <ScrollingText />

      {/* Features Section */}
      <section id="features" className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-4xl sm:text-5xl font-bold mb-4">
            <span className="bg-gradient-to-r from-blue-400 to-purple-600 bg-clip-text text-transparent">Powerful Features</span>
          </h2>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto">Everything you need to automate customer interactions and boost revenue</p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {/* Feature Card 1 */}
          <Card3D className="group">
            <div className="relative bg-gradient-to-br from-blue-900/40 to-purple-900/40 backdrop-blur-xl p-8 rounded-xl border border-white/10 hover:border-blue-500/50 transition-all h-full overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/0 to-purple-500/0 group-hover:from-blue-500/10 group-hover:to-purple-500/10 transition-all duration-500" />
              <div className="relative z-10">
                <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-blue-600 rounded-lg flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-6 transition-all">
                  <Mic className="w-6 h-6" />
                </div>
                <h3 className="text-2xl font-bold mb-4 group-hover:text-blue-300 transition-colors">Natural Voice AI</h3>
                <p className="text-gray-300">Advanced AI understands natural language, handles complex requests, and provides human-like conversations.</p>
                <ul className="mt-6 space-y-2">
                  <li className="flex items-center gap-2 text-sm text-gray-400">
                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                    Multi-language support
                  </li>
                  <li className="flex items-center gap-2 text-sm text-gray-400">
                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                    Context awareness
                  </li>
                  <li className="flex items-center gap-2 text-sm text-gray-400">
                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                    Custom training
                  </li>
                </ul>
              </div>
            </div>
          </Card3D>

          {/* Feature Card 2 */}
          <Card3D className="group">
            <div className="bg-gradient-to-br from-blue-900/40 to-purple-900/40 backdrop-blur-xl p-8 rounded-xl border border-white/10 hover:border-purple-500/50 transition-all h-full">
              <div className="w-12 h-12 bg-gradient-to-br from-purple-400 to-purple-600 rounded-lg flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Zap className="w-6 h-6" />
              </div>
              <h3 className="text-2xl font-bold mb-4">Real-Time Integration</h3>
              <p className="text-gray-300">Seamless integration with Square, Toast, Clover, and other POS systems for instant order processing.</p>
              <ul className="mt-6 space-y-2">
                <li className="flex items-center gap-2 text-sm text-gray-400">
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                  Instant menu sync
                </li>
                <li className="flex items-center gap-2 text-sm text-gray-400">
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                  Auto-payment links
                </li>
                <li className="flex items-center gap-2 text-sm text-gray-400">
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                  Inventory sync
                </li>
              </ul>
            </div>
          </Card3D>

          {/* Feature Card 3 */}
          <Card3D className="group">
            <div className="bg-gradient-to-br from-blue-900/40 to-purple-900/40 backdrop-blur-xl p-8 rounded-xl border border-white/10 hover:border-pink-500/50 transition-all h-full">
              <div className="w-12 h-12 bg-gradient-to-br from-pink-400 to-pink-600 rounded-lg flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <BarChart3 className="w-6 h-6" />
              </div>
              <h3 className="text-2xl font-bold mb-4">Advanced Analytics</h3>
              <p className="text-gray-300">Real-time dashboards show call metrics, revenue impact, customer insights, and AI performance data.</p>
              <ul className="mt-6 space-y-2">
                <li className="flex items-center gap-2 text-sm text-gray-400">
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                  Call analytics
                </li>
                <li className="flex items-center gap-2 text-sm text-gray-400">
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                  Revenue tracking
                </li>
                <li className="flex items-center gap-2 text-sm text-gray-400">
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                  KPI dashboards
                </li>
              </ul>
            </div>
          </Card3D>

          {/* Feature Card 4 */}
          <Card3D className="group">
            <div className="bg-gradient-to-br from-blue-900/40 to-purple-900/40 backdrop-blur-xl p-8 rounded-xl border border-white/10 hover:border-blue-500/50 transition-all h-full">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-blue-600 rounded-lg flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Shield className="w-6 h-6" />
              </div>
              <h3 className="text-2xl font-bold mb-4">Enterprise Security</h3>
              <p className="text-gray-300">Bank-grade encryption, PCI compliance, automatic backups, and 24/7 monitoring for peace of mind.</p>
              <ul className="mt-6 space-y-2">
                <li className="flex items-center gap-2 text-sm text-gray-400">
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                  ISO 27001 certified
                </li>
                <li className="flex items-center gap-2 text-sm text-gray-400">
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                  PCI-DSS compliant
                </li>
                <li className="flex items-center gap-2 text-sm text-gray-400">
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                  99.9% uptime SLA
                </li>
              </ul>
            </div>
          </Card3D>

          {/* Feature Card 5 */}
          <Card3D className="group">
            <div className="bg-gradient-to-br from-blue-900/40 to-purple-900/40 backdrop-blur-xl p-8 rounded-xl border border-white/10 hover:border-purple-500/50 transition-all h-full">
              <div className="w-12 h-12 bg-gradient-to-br from-purple-400 to-purple-600 rounded-lg flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Headphones className="w-6 h-6" />
              </div>
              <h3 className="text-2xl font-bold mb-4">Premium Support</h3>
              <p className="text-gray-300">Dedicated account managers, priority support, custom training, and ongoing optimization for your team.</p>
              <ul className="mt-6 space-y-2">
                <li className="flex items-center gap-2 text-sm text-gray-400">
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                  24/7 support
                </li>
                <li className="flex items-center gap-2 text-sm text-gray-400">
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                  Phone & email
                </li>
                <li className="flex items-center gap-2 text-sm text-gray-400">
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                  Custom integrations
                </li>
              </ul>
            </div>
          </Card3D>

          {/* Feature Card 6 */}
          <Card3D className="group">
            <div className="bg-gradient-to-br from-blue-900/40 to-purple-900/40 backdrop-blur-xl p-8 rounded-xl border border-white/10 hover:border-pink-500/50 transition-all h-full">
              <div className="w-12 h-12 bg-gradient-to-br from-pink-400 to-pink-600 rounded-lg flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <TrendingUp className="w-6 h-6" />
              </div>
              <h3 className="text-2xl font-bold mb-4">Revenue Growth</h3>
              <p className="text-gray-300">Increase order volume by 40%, reduce response times, and improve customer satisfaction with intelligent automation.</p>
              <ul className="mt-6 space-y-2">
                <li className="flex items-center gap-2 text-sm text-gray-400">
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                  +40% orders
                </li>
                <li className="flex items-center gap-2 text-sm text-gray-400">
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                  -60% wait time
                </li>
                <li className="flex items-center gap-2 text-sm text-gray-400">
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                  +35% satisfaction
                </li>
              </ul>
            </div>
          </Card3D>
        </div>
      </section>

      {/* Benefits Section */}
      <section id="benefits" className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-4xl sm:text-5xl font-bold mb-4">
            <span className="bg-gradient-to-r from-blue-400 to-purple-600 bg-clip-text text-transparent">Why Restaurants Love Heyloo</span>
          </h2>
        </div>

        <div className="grid md:grid-cols-2 gap-12 items-center">
          {/* Left side - Benefits list */}
          <div className="space-y-8">
            {[
              {
                icon: <Zap className="w-8 h-8" />,
                title: 'Instant Setup',
                description: 'Get your AI agent live in just 5 minutes. No complex configuration needed.'
              },
              {
                icon: <Building2 className="w-8 h-8" />,
                title: 'Works with Any POS',
                description: 'Integrates seamlessly with Square, Toast, Clover, and 50+ other systems.'
              },
              {
                icon: <Clock className="w-8 h-8" />,
                title: '24/7 Availability',
                description: 'Handle calls 24/7 without hiring additional staff or overtime costs.'
              },
              {
                icon: <TrendingUp className="w-8 h-8" />,
                title: 'Proven ROI',
                description: 'See measurable results within the first week. Average 3-6x ROI in year one.'
              }
            ].map((item, i) => (
              <div key={i} className="flex gap-6 group">
                <div className="w-16 h-16 min-w-16 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-lg flex items-center justify-center text-blue-400 group-hover:text-purple-400 group-hover:scale-110 transition-all">
                  {item.icon}
                </div>
                <div>
                  <h3 className="text-xl font-bold mb-2 group-hover:text-blue-300 transition-colors">{item.title}</h3>
                  <p className="text-gray-400">{item.description}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Right side - Stats */}
          <div className="space-y-8">
            <div className="bg-gradient-to-br from-blue-900/30 to-purple-900/30 backdrop-blur-xl rounded-xl p-12 border border-white/10">
              <div className="grid grid-cols-2 gap-8 mb-8">
                <Counter value={500} label="Active Restaurants" />
                <Counter value={50000} label="Calls/Month" />
              </div>
              <div className="grid grid-cols-2 gap-8">
                <Counter value={8} label="Million$ Generated" />
                <Counter value={98} label="Uptime %" />
              </div>
            </div>

            <div className="bg-gradient-to-br from-blue-900/20 to-purple-900/20 backdrop-blur-xl rounded-xl p-8 border border-white/10">
              <div className="flex items-start gap-4 mb-6">
                <Star className="w-6 h-6 text-yellow-400 mt-1" />
                <div>
                  <p className="text-lg font-semibold">
                    "Heyloo transformed how we handle orders. We're processing 40% more calls with the same staff."
                  </p>
                  <p className="text-gray-400 text-sm mt-2">- Marco D., Restaurant Owner</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl p-12 text-center relative overflow-hidden">
            {/* Animated background */}
            <div className="absolute inset-0 opacity-30">
              <div className="absolute top-0 left-1/4 w-40 h-40 bg-white rounded-full mix-blend-multiply filter blur-3xl animate-pulse" />
              <div className="absolute bottom-0 right-1/4 w-40 h-40 bg-white rounded-full mix-blend-multiply filter blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />
            </div>

            <div className="relative z-10">
              <h2 className="text-4xl sm:text-5xl font-bold mb-6">Ready to Transform Your Restaurant?</h2>
              <p className="text-xl opacity-90 mb-8 max-w-2xl mx-auto">
                Join hundreds of restaurants already using Heyloo to automate orders and boost revenue.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link
                  to="/onboarding"
                  className="px-10 py-4 bg-white text-purple-600 rounded-lg font-bold text-lg hover:shadow-xl transition-all flex items-center gap-2 justify-center sm:justify-start"
                >
                  Start Free Trial (No Card Required) <ArrowRight className="w-5 h-5" />
                </Link>
                <button className="px-10 py-4 border-2 border-white rounded-lg font-bold text-lg hover:bg-white/10 transition-all">
                  Schedule Demo
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 font-bold text-lg bg-gradient-to-r from-blue-400 to-purple-600 bg-clip-text text-transparent mb-4">
                <Sparkles className="w-5 h-5 text-blue-400" />
                Heyloo
              </div>
              <p className="text-gray-400 text-sm">AI voice agents for modern restaurants</p>
            </div>
            <div>
              <h4 className="font-bold mb-4">Product</h4>
              <ul className="space-y-2 text-gray-400 text-sm">
                <li><a href="#features" className="hover:text-white transition">Features</a></li>
                <li><a href="#" className="hover:text-white transition">Pricing</a></li>
                <li><a href="#" className="hover:text-white transition">Security</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-4">Company</h4>
              <ul className="space-y-2 text-gray-400 text-sm">
                <li><a href="#" className="hover:text-white transition">About</a></li>
                <li><a href="#" className="hover:text-white transition">Blog</a></li>
                <li><a href="#" className="hover:text-white transition">Contact</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-4">Legal</h4>
              <ul className="space-y-2 text-gray-400 text-sm">
                <li><a href="/privacy" className="hover:text-white transition">Privacy</a></li>
                <li><a href="/terms" className="hover:text-white transition">Terms</a></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row items-center justify-between">
            <p className="text-gray-400 text-sm">© 2025 Heyloo. All rights reserved.</p>
            <div className="flex gap-4 mt-4 md:mt-0">
              <a href="#" className="text-gray-400 hover:text-white transition">Twitter</a>
              <a href="#" className="text-gray-400 hover:text-white transition">LinkedIn</a>
              <a href="#" className="text-gray-400 hover:text-white transition">GitHub</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
