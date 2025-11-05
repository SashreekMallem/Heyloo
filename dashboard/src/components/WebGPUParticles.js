import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useRef } from 'react';
export function WebGPUParticles() {
    const containerRef = useRef(null);
    const cleanupRef = useRef(null);
    useEffect(() => {
        if (!containerRef.current)
            return;
        let camera, scene, renderer, controls, updateCompute;
        let animationId;
        async function init() {
            // Dynamic imports for Three.js WebGPU
            const THREE = await import('three/webgpu');
            const { float, If, PI, color, cos, instanceIndex, Loop, mix, mod, sin, instancedArray, Fn, uint, uniform, uniformArray, hash, vec3, vec4 } = await import('three/tsl');
            const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
            camera = new THREE.PerspectiveCamera(25, window.innerWidth / window.innerHeight, 0.1, 100);
            camera.position.set(3, 5, 8);
            scene = new THREE.Scene();
            // ambient light
            const ambientLight = new THREE.AmbientLight('#ffffff', 0.5);
            scene.add(ambientLight);
            // directional light
            const directionalLight = new THREE.DirectionalLight('#ffffff', 1.5);
            directionalLight.position.set(4, 2, 0);
            scene.add(directionalLight);
            // renderer
            renderer = new THREE.WebGPURenderer({ antialias: true, alpha: true });
            renderer.setPixelRatio(window.devicePixelRatio);
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.setClearColor('#0a0a0f', 1);
            if (containerRef.current) {
                containerRef.current.appendChild(renderer.domElement);
            }
            await renderer.init();
            controls = new OrbitControls(camera, renderer.domElement);
            controls.minDistance = 3;
            controls.maxDistance = 50;
            controls.enableDamping = true;
            controls.dampingFactor = 0.05;
            // attractors
            const attractorsLength = 3;
            const attractorsPositions = uniformArray('attractorsPositions', [
                new THREE.Vector3(2, 0, 0),
                new THREE.Vector3(-2, 0, 0),
                new THREE.Vector3(0, 2, 0)
            ]);
            const attractorsRotationAxes = uniformArray('attractorsRotationAxes', [
                new THREE.Vector3(0, 1, 0).normalize(),
                new THREE.Vector3(1, 0, 1).normalize(),
                new THREE.Vector3(1, 0, 0).normalize()
            ]);
            // particles
            const count = Math.pow(2, 18); // 262,144 particles
            const material = new THREE.SpriteNodeMaterial({
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const attractorMass = uniform(Number(`1e${7}`));
            const particleGlobalMass = uniform(Number(`1e${4}`));
            const timeScale = uniform(1);
            const spinningStrength = uniform(2.75);
            const maxSpeed = uniform(8);
            const gravityConstant = 6.67e-11;
            const velocityDamping = uniform(0.1);
            const scale = uniform(0.008);
            const boundHalfExtent = uniform(8);
            const colorA = uniform(color('#5900ff'));
            const colorB = uniform(color('#ffa575'));
            const positionBuffer = instancedArray(count, 'vec3');
            const velocityBuffer = instancedArray(count, 'vec3');
            const sphericalToVec3 = Fn(([phi, theta]) => {
                const sinPhiRadius = sin(phi);
                return vec3(sinPhiRadius.mul(cos(theta)), cos(phi), sinPhiRadius.mul(sin(theta)));
            });
            const init = Fn(() => {
                const position = positionBuffer.element(instanceIndex);
                const velocity = velocityBuffer.element(instanceIndex);
                const phi = hash(instanceIndex).mul(PI).mul(2);
                const theta = hash(instanceIndex.add(uint(Math.random() * 0xffffff))).mul(PI);
                const randRadius = hash(instanceIndex.add(uint(Math.random() * 0xffffff))).remap(0.25, 1).mul(4);
                position.assign(sphericalToVec3(phi, theta).mul(randRadius));
                const baseVelocity = sphericalToVec3(phi, theta).mul(0.05);
                velocity.assign(baseVelocity);
            });
            const initCompute = init().compute(count);
            renderer.compute(initCompute);
            // update compute
            const particleMassMultiplier = hash(instanceIndex.add(uint(Math.random() * 0xffffff))).remap(0.25, 1).toVar();
            const particleMass = particleMassMultiplier.mul(particleGlobalMass).toVar();
            const update = Fn(() => {
                const delta = float(1 / 60).mul(timeScale).toVar();
                const position = positionBuffer.element(instanceIndex);
                const velocity = velocityBuffer.element(instanceIndex);
                // force
                const force = vec3(0).toVar();
                Loop(attractorsLength, ({ i }) => {
                    const attractorPosition = attractorsPositions.element(i);
                    const attractorRotationAxis = attractorsRotationAxes.element(i);
                    const toAttractor = attractorPosition.sub(position);
                    const distance = toAttractor.length();
                    const direction = toAttractor.normalize();
                    // gravity
                    const gravityStrength = attractorMass.mul(particleMass).mul(gravityConstant).div(distance.pow(2)).toVar();
                    const gravityForce = direction.mul(gravityStrength);
                    force.addAssign(gravityForce);
                    // spinning
                    const spinningForce = attractorRotationAxis.mul(gravityStrength).mul(spinningStrength);
                    const spinningVelocity = spinningForce.cross(toAttractor);
                    force.addAssign(spinningVelocity);
                });
                // velocity
                velocity.addAssign(force.mul(delta));
                const speed = velocity.length();
                If(speed.greaterThan(maxSpeed), () => {
                    velocity.assign(velocity.normalize().mul(maxSpeed));
                });
                velocity.mulAssign(velocityDamping.oneMinus());
                // position
                position.addAssign(velocity.mul(delta));
                // box loop
                const halfHalfExtent = boundHalfExtent.div(2).toVar();
                position.assign(mod(position.add(halfHalfExtent), boundHalfExtent).sub(halfHalfExtent));
            });
            updateCompute = update().compute(count);
            // nodes
            material.positionNode = positionBuffer.toAttribute();
            material.colorNode = Fn(() => {
                const velocity = velocityBuffer.toAttribute();
                const speed = velocity.length();
                const colorMix = speed.div(maxSpeed).smoothstep(0, 0.5);
                const finalColor = mix(colorA, colorB, colorMix);
                return vec4(finalColor, 1);
            })();
            material.scaleNode = particleMassMultiplier.mul(scale);
            // mesh
            const geometry = new THREE.PlaneGeometry(1, 1);
            const mesh = new THREE.InstancedMesh(geometry, material, count);
            scene.add(mesh);
            // animation loop
            function animate() {
                animationId = requestAnimationFrame(animate);
                controls.update();
                renderer.compute(updateCompute);
                renderer.render(scene, camera);
            }
            animate();
            // resize handler
            function onWindowResize() {
                camera.aspect = window.innerWidth / window.innerHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(window.innerWidth, window.innerHeight);
            }
            window.addEventListener('resize', onWindowResize);
            // cleanup function
            cleanupRef.current = () => {
                cancelAnimationFrame(animationId);
                window.removeEventListener('resize', onWindowResize);
                if (renderer) {
                    renderer.dispose();
                    if (containerRef.current && renderer.domElement) {
                        containerRef.current.removeChild(renderer.domElement);
                    }
                }
            };
        }
        init().catch(console.error);
        return () => {
            if (cleanupRef.current) {
                cleanupRef.current();
            }
        };
    }, []);
    return (_jsx("div", { ref: containerRef, style: {
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            zIndex: 0,
        } }));
}
