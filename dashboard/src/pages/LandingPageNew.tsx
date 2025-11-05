import React, { useRef, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion, useScroll, useTransform, useInView } from 'framer-motion';
import { Phone, MessageSquare, TrendingUp, Users, ArrowRight, Check, Zap, BarChart3, Clock, Sparkles, Bot, Headphones, Star, Shield } from 'lucide-react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// Advanced Particle System with Attractors (WebGPU-style physics simulation)
function ParticleAttractors() {
  const particlesRef = useRef<THREE.Points>(null);
  const velocitiesRef = useRef<Float32Array>();
  const massesRef = useRef<Float32Array>();
  const attractorsRef = useRef<{
    position: THREE.Vector3;
    rotationAxis: THREE.Vector3;
  }[]>([
    {
      position: new THREE.Vector3(2, 0, 0),
      rotationAxis: new THREE.Vector3(0, 1, 0).normalize(),
    },
    {
      position: new THREE.Vector3(-2, 0, 0),
      rotationAxis: new THREE.Vector3(1, 0, 1).normalize(),
    },
    {
      position: new THREE.Vector3(0, 2, 0),
      rotationAxis: new THREE.Vector3(1, 0, 0).normalize(),
    },
  ]);

  const particleCount = 262144; // 2^18 like the original

  const { positions, colors } = useMemo(() => {
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    const masses = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      // Random initial positions in a sphere (like WebGPU version)
      const phi = Math.random() * Math.PI * 2;
      const theta = Math.random() * Math.PI;
      const radius = Math.random() * 4;

      positions[i3] = radius * Math.sin(theta) * Math.cos(phi);
      positions[i3 + 1] = radius * Math.sin(theta) * Math.sin(phi);
      positions[i3 + 2] = radius * Math.cos(theta);

      // Initial velocities (spherical distribution)
      const velPhi = Math.random() * Math.PI * 2;
      const velTheta = Math.random() * Math.PI;
      const velMag = 0.05;
      
      velocities[i3] = velMag * Math.sin(velTheta) * Math.cos(velPhi);
      velocities[i3 + 1] = velMag * Math.sin(velTheta) * Math.sin(velPhi);
      velocities[i3 + 2] = velMag * Math.cos(velTheta);

      // Particle mass variation (0.25 to 1.0)
      masses[i] = 0.25 + Math.random() * 0.75;

      // Initial colors (will be updated based on speed)
      colors[i3] = 0.35; // Purple base
      colors[i3 + 1] = 0.0;
      colors[i3 + 2] = 1.0;
    }

    velocitiesRef.current = velocities;
    massesRef.current = masses;

    return { positions, colors };
  }, []);

  useFrame((state) => {
    if (!particlesRef.current || !velocitiesRef.current || !massesRef.current) return;

    const positions = particlesRef.current.geometry.attributes.position.array as Float32Array;
    const colors = particlesRef.current.geometry.attributes.color.array as Float32Array;
    const velocities = velocitiesRef.current;
    const masses = massesRef.current;
    const time = state.clock.elapsedTime;

    // Update attractor positions (they orbit like WebGPU version)
    attractorsRef.current[0].position.set(
      Math.cos(time * 0.5) * 3,
      Math.sin(time * 0.3) * 2,
      Math.sin(time * 0.4) * 2.5
    );
    attractorsRef.current[1].position.set(
      Math.cos(time * 0.5 + Math.PI * 0.66) * 3,
      Math.sin(time * 0.3 + Math.PI * 0.66) * 2,
      Math.sin(time * 0.4 + Math.PI * 0.66) * 2.5
    );
    attractorsRef.current[2].position.set(
      Math.cos(time * 0.5 + Math.PI * 1.33) * 3,
      Math.sin(time * 0.3 + Math.PI * 1.33) * 2,
      Math.sin(time * 0.4 + Math.PI * 1.33) * 2.5
    );

    // WebGPU-style physics constants
    const attractorMass = 1e7;
    const particleGlobalMass = 1e4;
    const gravityConstant = 6.67e-11;
    const spinningStrength = 2.75;
    const maxSpeed = 8.0;
    const velocityDamping = 0.1;
    const boundHalfExtent = 8;
    const delta = 1 / 60; // Fixed delta like WebGPU version

    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;

      const px = positions[i3];
      const py = positions[i3 + 1];
      const pz = positions[i3 + 2];

      const particleMass = masses[i] * particleGlobalMass;

      let fx = 0, fy = 0, fz = 0;

      // Calculate forces from each attractor (WebGPU compute shader logic)
      attractorsRef.current.forEach((attractor) => {
        const dx = attractor.position.x - px;
        const dy = attractor.position.y - py;
        const dz = attractor.position.z - pz;

        const distSq = dx * dx + dy * dy + dz * dz + 0.0001;
        const dist = Math.sqrt(distSq);
        
        // Gravity force (F = G * m1 * m2 / r^2)
        const gravityStrength = (attractorMass * particleMass * gravityConstant) / distSq;
        
        const nx = dx / dist;
        const ny = dy / dist;
        const nz = dz / dist;

        fx += nx * gravityStrength;
        fy += ny * gravityStrength;
        fz += nz * gravityStrength;

        // Spinning force (cross product with rotation axis)
        const spinForce = gravityStrength * spinningStrength;
        const crossX = attractor.rotationAxis.y * dz - attractor.rotationAxis.z * dy;
        const crossY = attractor.rotationAxis.z * dx - attractor.rotationAxis.x * dz;
        const crossZ = attractor.rotationAxis.x * dy - attractor.rotationAxis.y * dx;

        fx += crossX * spinForce;
        fy += crossY * spinForce;
        fz += crossZ * spinForce;
      });

      // Update velocity
      velocities[i3] += fx * delta;
      velocities[i3 + 1] += fy * delta;
      velocities[i3 + 2] += fz * delta;

      // Limit speed
      const speed = Math.sqrt(
        velocities[i3] ** 2 + velocities[i3 + 1] ** 2 + velocities[i3 + 2] ** 2
      );
      if (speed > maxSpeed) {
        const factor = maxSpeed / speed;
        velocities[i3] *= factor;
        velocities[i3 + 1] *= factor;
        velocities[i3 + 2] *= factor;
      }

      // Apply damping
      velocities[i3] *= (1 - velocityDamping);
      velocities[i3 + 1] *= (1 - velocityDamping);
      velocities[i3 + 2] *= (1 - velocityDamping);

      // Update position
      positions[i3] += velocities[i3] * delta;
      positions[i3 + 1] += velocities[i3 + 1] * delta;
      positions[i3 + 2] += velocities[i3 + 2] * delta;

      // Box loop (modulo wrapping like WebGPU version)
      const halfHalfExtent = boundHalfExtent / 2;
      positions[i3] = ((positions[i3] + halfHalfExtent) % boundHalfExtent) - halfHalfExtent;
      positions[i3 + 1] = ((positions[i3 + 1] + halfHalfExtent) % boundHalfExtent) - halfHalfExtent;
      positions[i3 + 2] = ((positions[i3 + 2] + halfHalfExtent) % boundHalfExtent) - halfHalfExtent;

      // Update colors based on speed (purple to orange gradient)
      const speedNormalized = speed / maxSpeed;
      const colorMix = Math.min(speedNormalized, 1);
      const smoothMix = colorMix * colorMix * (3 - 2 * colorMix); // smoothstep

      // Color A: #5900ff (purple), Color B: #ffa575 (orange)
      colors[i3] = 0.35 + smoothMix * 0.65; // R: 0.35 -> 1.0
      colors[i3 + 1] = 0.0 + smoothMix * 0.65; // G: 0.0 -> 0.65
      colors[i3 + 2] = 1.0 - smoothMix * 0.54; // B: 1.0 -> 0.46
    }

    particlesRef.current.geometry.attributes.position.needsUpdate = true;
    particlesRef.current.geometry.attributes.color.needsUpdate = true;
  });

  return (
    <points ref={particlesRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={particleCount}
          array={positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-color"
          count={particleCount}
          array={colors}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.008}
        vertexColors
        transparent
        opacity={0.9}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

export function LandingPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"]
  });

  const heroOpacity = useTransform(scrollYProgress, [0, 0.2], [1, 0]);
  const heroScale = useTransform(scrollYProgress, [0, 0.2], [1, 0.8]);

  return (
    <div ref={containerRef} className="relative bg-[#0a0a0f] text-white overflow-hidden">
      {/* Enhanced Interactive WebGPU Particle Background */}
      <div className="fixed inset-0 z-0">
        <iframe
          src="/particles_interactive.html"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            border: 'none',
            pointerEvents: 'auto',
          }}
          title="WebGPU Particles"
        />
        
        {/* Subtle Gradient Overlays for text readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a0f]/20 via-transparent to-[#0a0a0f]/60 pointer-events-none" />
      </div>

      {/* Navigation */}
      <Navigation />

      {/* Hero Section */}
      <motion.section 
        style={{ opacity: heroOpacity, scale: heroScale }}
        className="relative min-h-screen flex items-center justify-center px-6"
      >
        <div className="max-w-7xl mx-auto text-center relative z-10">
          {/* Animated Badge */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 backdrop-blur-sm mb-8"
          >
            <Sparkles className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-medium bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              AI-Powered Voice Agents for Restaurants
            </span>
          </motion.div>

          {/* Hero Title with Text Reveal Animation */}
          <div className="relative mb-8">
            <motion.h1
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="text-6xl md:text-8xl lg:text-9xl font-bold mb-6 leading-[0.9] tracking-tight"
            >
              <span className="block bg-gradient-to-r from-white via-blue-100 to-purple-100 bg-clip-text text-transparent">
                Voice AI that
              </span>
              <span className="block bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent mt-4">
                never sleeps
              </span>
            </motion.h1>
            
            {/* Floating Elements */}
            <motion.div
              animate={{ y: [0, -20, 0], rotate: [0, 5, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              className="absolute -top-20 -left-20 w-40 h-40 bg-blue-500/10 rounded-full blur-3xl"
            />
            <motion.div
              animate={{ y: [0, 20, 0], rotate: [0, -5, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
              className="absolute -bottom-20 -right-20 w-60 h-60 bg-purple-500/10 rounded-full blur-3xl"
            />
          </div>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="text-xl md:text-2xl text-gray-400 max-w-3xl mx-auto mb-12 leading-relaxed"
          >
            Handle every call, take every order, and serve every customer — 24/7 with human-like voice AI
          </motion.p>

          {/* CTA Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.6 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <Link to="/signup">
              <button className="group relative px-8 py-4 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full font-semibold text-lg overflow-hidden transition-all hover:scale-105 hover:shadow-2xl hover:shadow-blue-500/50">
                <span className="relative z-10 flex items-center gap-2">
                  Start Free Trial
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </span>
                <div className="absolute inset-0 bg-gradient-to-r from-purple-600 to-pink-600 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            </Link>
            <button className="px-8 py-4 bg-white/5 hover:bg-white/10 backdrop-blur-sm border border-white/10 rounded-full font-semibold text-lg transition-all hover:scale-105">
              Watch Demo
            </button>
          </motion.div>

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.8 }}
            className="mt-20 grid grid-cols-3 gap-8 max-w-2xl mx-auto"
          >
            {[
              { value: "99.9%", label: "Uptime" },
              { value: "< 2s", label: "Response Time" },
              { value: "24/7", label: "Availability" }
            ].map((stat, i) => (
              <div key={i} className="text-center">
                <div className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent mb-2">
                  {stat.value}
                </div>
                <div className="text-sm text-gray-500">{stat.label}</div>
              </div>
            ))}
          </motion.div>
        </div>
      </motion.section>

      {/* Features Section with Scroll Animations */}
      <FeaturesSection />

      {/* How It Works */}
      <HowItWorksSection />

      {/* Benefits */}
      <BenefitsSection />

      {/* Social Proof */}
      <SocialProofSection />

      {/* CTA Section */}
      <CTASection />

      {/* Footer */}
      <Footer />
    </div>
  );
}

// Navigation Component
function Navigation() {
  return (
    <motion.nav
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.6 }}
      className="fixed top-0 left-0 right-0 z-50 px-6 py-4"
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center">
            <Phone className="w-5 h-5" />
          </div>
          <span className="text-xl font-bold">Heyloo</span>
        </div>

        <div className="hidden md:flex items-center gap-8">
          <a href="#features" className="text-gray-400 hover:text-white transition-colors">Features</a>
          <a href="#how-it-works" className="text-gray-400 hover:text-white transition-colors">How it Works</a>
          <a href="#pricing" className="text-gray-400 hover:text-white transition-colors">Pricing</a>
        </div>

        <div className="flex items-center gap-4">
          <Link to="/login" className="text-gray-400 hover:text-white transition-colors">
            Login
          </Link>
          <Link to="/signup">
            <button className="px-6 py-2 bg-white/10 hover:bg-white/20 backdrop-blur-sm border border-white/20 rounded-full font-medium transition-all">
              Get Started
            </button>
          </Link>
        </div>
      </div>
    </motion.nav>
  );
}

// Features Section with Parallax Cards
function FeaturesSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: false, amount: 0.3 });

  const features = [
    {
      icon: <Bot className="w-8 h-8" />,
      title: "Natural Conversations",
      description: "AI that understands context, handles complex orders, and speaks naturally like your best employee",
      color: "from-blue-600 to-cyan-600"
    },
    {
      icon: <Zap className="w-8 h-8" />,
      title: "Instant Setup",
      description: "Go live in minutes. No complex integrations, no training required. Just plug in and start taking orders",
      color: "from-purple-600 to-pink-600"
    },
    {
      icon: <BarChart3 className="w-8 h-8" />,
      title: "Real-Time Analytics",
      description: "Track every call, order, and customer interaction with actionable insights and performance metrics",
      color: "from-pink-600 to-rose-600"
    },
    {
      icon: <Headphones className="w-8 h-8" />,
      title: "24/7 Availability",
      description: "Never miss a call again. Your AI agent works round the clock, handling unlimited concurrent calls",
      color: "from-orange-600 to-red-600"
    },
    {
      icon: <Shield className="w-8 h-8" />,
      title: "PCI Compliant",
      description: "Secure payment processing integrated with Stripe. Your customers' data is always protected",
      color: "from-emerald-600 to-teal-600"
    },
    {
      icon: <MessageSquare className="w-8 h-8" />,
      title: "Smart Order Management",
      description: "Automatically syncs with your POS system. Orders flow seamlessly from call to kitchen",
      color: "from-violet-600 to-purple-600"
    }
  ];

  return (
    <section ref={sectionRef} id="features" className="relative py-32 px-6">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
          className="text-center mb-20"
        >
          <h2 className="text-5xl md:text-7xl font-bold mb-6 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
            Everything you need
          </h2>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto">
            Powerful features that transform how restaurants handle customer calls
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, i) => (
            <FeatureCard key={i} feature={feature} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

// Individual Feature Card with Hover Effects
function FeatureCard({ feature, index }: { feature: any; index: number }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(cardRef, { once: false, amount: 0.5 });

  return (
    <motion.div
      ref={cardRef}
      initial={{ opacity: 0, y: 60 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay: index * 0.1 }}
      whileHover={{ y: -10, scale: 1.02 }}
      className="group relative p-8 rounded-3xl bg-white/5 backdrop-blur-sm border border-white/10 hover:border-white/20 transition-all cursor-pointer overflow-hidden"
    >
      {/* Gradient Glow on Hover */}
      <div className={`absolute inset-0 bg-gradient-to-br ${feature.color} opacity-0 group-hover:opacity-10 transition-opacity blur-2xl`} />
      
      <div className="relative z-10">
        <div className={`inline-flex p-3 rounded-2xl bg-gradient-to-br ${feature.color} mb-6`}>
          {feature.icon}
        </div>
        <h3 className="text-2xl font-bold mb-3">{feature.title}</h3>
        <p className="text-gray-400 leading-relaxed">{feature.description}</p>
      </div>

      {/* Corner Accent */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-white/5 to-transparent rounded-bl-full opacity-0 group-hover:opacity-100 transition-opacity" />
    </motion.div>
  );
}

// How It Works Section
function HowItWorksSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: false, amount: 0.3 });

  const steps = [
    {
      number: "01",
      title: "Connect Your Menu",
      description: "Sync your menu from Square, Clover, or any POS system in seconds",
      icon: <MessageSquare className="w-6 h-6" />
    },
    {
      number: "02",
      title: "Customize Your Agent",
      description: "Train your AI with your restaurant's personality, specials, and policies",
      icon: <Bot className="w-6 h-6" />
    },
    {
      number: "03",
      title: "Go Live",
      description: "Start taking calls instantly. Orders sync automatically to your POS",
      icon: <Zap className="w-6 h-6" />
    }
  ];

  return (
    <section ref={sectionRef} id="how-it-works" className="relative py-32 px-6">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
          className="text-center mb-20"
        >
          <h2 className="text-5xl md:text-7xl font-bold mb-6 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
            Simple setup
          </h2>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto">
            Get started in minutes, not weeks
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8 relative">
          {/* Connecting Lines */}
          <div className="hidden md:block absolute top-1/2 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-600/50 via-purple-600/50 to-pink-600/50 -translate-y-1/2" />

          {steps.map((step, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 40 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: i * 0.2 }}
              className="relative"
            >
              <div className="relative z-10 bg-[#0a0a0f] p-8 rounded-3xl border border-white/10">
                <div className="text-6xl font-bold bg-gradient-to-br from-blue-600 to-purple-600 bg-clip-text text-transparent mb-4">
                  {step.number}
                </div>
                <div className="inline-flex p-3 rounded-xl bg-white/5 mb-4">
                  {step.icon}
                </div>
                <h3 className="text-2xl font-bold mb-3">{step.title}</h3>
                <p className="text-gray-400">{step.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// Benefits Section
function BenefitsSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: false, amount: 0.3 });

  return (
    <section ref={sectionRef} className="relative py-32 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <motion.div
            initial={{ opacity: 0, x: -60 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.8 }}
          >
            <h2 className="text-5xl md:text-7xl font-bold mb-8 leading-tight">
              <span className="bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                Never miss a call,
              </span>
              <br />
              <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                never lose revenue
              </span>
            </h2>
            <p className="text-xl text-gray-400 mb-8 leading-relaxed">
              Every missed call is lost revenue. Our AI ensures you capture every opportunity, whether it's rush hour or 3 AM.
            </p>
            
            <div className="space-y-4">
              {[
                "50% increase in order volume",
                "Zero missed calls during peak hours",
                "$2,000+ additional monthly revenue",
                "Staff focus on in-house customers"
              ].map((benefit, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -20 }}
                  animate={isInView ? { opacity: 1, x: 0 } : {}}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  className="flex items-center gap-3"
                >
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center">
                    <Check className="w-4 h-4" />
                  </div>
                  <span className="text-lg">{benefit}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 60 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.8 }}
            className="relative"
          >
            <div className="relative rounded-3xl overflow-hidden bg-gradient-to-br from-blue-600/20 to-purple-600/20 p-8 backdrop-blur-sm border border-white/10">
              {/* Mock Dashboard */}
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">Today's Performance</span>
                  <span className="text-sm text-green-400">+23%</span>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl bg-white/5">
                    <div className="text-3xl font-bold mb-1">127</div>
                    <div className="text-sm text-gray-400">Calls Handled</div>
                  </div>
                  <div className="p-4 rounded-xl bg-white/5">
                    <div className="text-3xl font-bold mb-1">$4,230</div>
                    <div className="text-sm text-gray-400">Revenue</div>
                  </div>
                </div>

                <div className="h-48 bg-white/5 rounded-xl p-4">
                  <div className="h-full flex items-end gap-2">
                    {[40, 65, 45, 80, 60, 90, 70].map((height, i) => (
                      <div key={i} className="flex-1 bg-gradient-to-t from-blue-600 to-purple-600 rounded-t" style={{ height: `${height}%` }} />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Floating Decorations */}
            <div className="absolute -top-10 -right-10 w-40 h-40 bg-purple-500/20 rounded-full blur-3xl" />
            <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-blue-500/20 rounded-full blur-3xl" />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// Social Proof Section
function SocialProofSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: false, amount: 0.3 });

  return (
    <section ref={sectionRef} className="relative py-32 px-6">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
          className="text-center mb-20"
        >
          <h2 className="text-5xl md:text-7xl font-bold mb-6 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
            Trusted by restaurants
          </h2>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8">
          {[
            {
              quote: "Game changer for our busy restaurant. We're taking 3x more phone orders without hiring more staff.",
              author: "Sarah Chen",
              role: "Owner, Chen's Kitchen",
              rating: 5
            },
            {
              quote: "The AI is so natural, customers can't tell it's not a real person. And it never makes mistakes.",
              author: "Mike Rodriguez",
              role: "Manager, Pizza Palace",
              rating: 5
            },
            {
              quote: "Best investment we've made. Paid for itself in the first month through increased orders.",
              author: "Jennifer Lee",
              role: "Owner, Sushi Express",
              rating: 5
            }
          ].map((testimonial, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 40 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: i * 0.15 }}
              className="p-8 rounded-3xl bg-white/5 backdrop-blur-sm border border-white/10"
            >
              <div className="flex gap-1 mb-4">
                {[...Array(testimonial.rating)].map((_, i) => (
                  <Star key={i} className="w-5 h-5 fill-yellow-500 text-yellow-500" />
                ))}
              </div>
              <p className="text-lg text-gray-300 mb-6 leading-relaxed">"{testimonial.quote}"</p>
              <div>
                <div className="font-semibold">{testimonial.author}</div>
                <div className="text-sm text-gray-400">{testimonial.role}</div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// CTA Section
function CTASection() {
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: false, amount: 0.5 });

  return (
    <section ref={sectionRef} className="relative py-32 px-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={isInView ? { opacity: 1, scale: 1 } : {}}
        transition={{ duration: 0.8 }}
        className="max-w-5xl mx-auto text-center relative"
      >
        <div className="relative z-10 p-16 rounded-3xl bg-gradient-to-br from-blue-600/20 to-purple-600/20 backdrop-blur-sm border border-white/20 overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(59,130,246,0.2),transparent_70%)]" />
          
          <div className="relative z-10">
            <h2 className="text-5xl md:text-7xl font-bold mb-6 bg-gradient-to-r from-white to-gray-200 bg-clip-text text-transparent">
              Ready to transform your restaurant?
            </h2>
            <p className="text-xl text-gray-300 mb-10 max-w-2xl mx-auto">
              Join hundreds of restaurants using AI to never miss a call and increase revenue
            </p>
            
            <Link to="/signup">
              <button className="group relative px-10 py-5 bg-white text-black rounded-full font-bold text-lg overflow-hidden transition-all hover:scale-105 hover:shadow-2xl hover:shadow-white/50">
                <span className="relative z-10 flex items-center gap-2">
                  Start Free Trial
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </span>
              </button>
            </Link>
            
            <p className="mt-6 text-sm text-gray-400">
              No credit card required • 14-day free trial • Cancel anytime
            </p>
          </div>
        </div>

        {/* Decorative Elements */}
        <div className="absolute -top-20 left-1/4 w-60 h-60 bg-blue-500/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-20 right-1/4 w-60 h-60 bg-purple-500/20 rounded-full blur-3xl" />
      </motion.div>
    </section>
  );
}

// Footer
function Footer() {
  return (
    <footer className="relative border-t border-white/10 py-12 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="grid md:grid-cols-4 gap-8 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center">
                <Phone className="w-5 h-5" />
              </div>
              <span className="text-xl font-bold">Heyloo</span>
            </div>
            <p className="text-gray-400 text-sm">
              AI-powered voice agents for restaurants
            </p>
          </div>

          <div>
            <h4 className="font-semibold mb-4">Product</h4>
            <ul className="space-y-2 text-sm text-gray-400">
              <li><a href="#features" className="hover:text-white transition-colors">Features</a></li>
              <li><a href="#pricing" className="hover:text-white transition-colors">Pricing</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Integrations</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-4">Company</h4>
            <ul className="space-y-2 text-sm text-gray-400">
              <li><a href="#" className="hover:text-white transition-colors">About</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Blog</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Careers</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-4">Legal</h4>
            <ul className="space-y-2 text-sm text-gray-400">
              <li><a href="#" className="hover:text-white transition-colors">Privacy</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Terms</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Security</a></li>
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-white/10 text-center text-sm text-gray-400">
          <p>© 2025 Heyloo. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
