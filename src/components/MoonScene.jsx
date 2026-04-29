import React, { useRef, useMemo, useState, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  PerspectiveCamera,
  Stars,
  Float,
  MeshDistortMaterial,
  PerformanceMonitor,
  ContactShadows,
  BakeShadows,
  Environment,
  Sparkles
} from '@react-three/drei';
import * as THREE from 'three';

const Moon = ({ scrollProgress, quality }) => {
  const moonRef = useRef();

  // Create a procedural cratered texture using Canvas
  const moonTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const context = canvas.getContext('2d');

    // Base color
    context.fillStyle = '#1e1e1e';
    context.fillRect(0, 0, 1024, 1024);

    // Add many craters
    for (let i = 0; i < 500; i++) {
      const x = Math.random() * 1024;
      const y = Math.random() * 1024;
      const r = Math.random() * 20 + 2;
      const opacity = Math.random() * 0.5;

      const gradient = context.createRadialGradient(x, y, 0, x, y, r);
      gradient.addColorStop(0, `rgba(0,0,0,${opacity})`);
      gradient.addColorStop(0.8, `rgba(50,50,50,${opacity})`);
      gradient.addColorStop(1, `rgba(80,80,80,0)`);

      context.fillStyle = gradient;
      context.beginPath();
      context.arc(x, y, r, 0, Math.PI * 2);
      context.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 8;
    return texture;
  }, []);

  useFrame((state) => {
    if (moonRef.current) {
      // Slow rotation
      moonRef.current.rotation.y += 0.001;
      // Subtle float
      moonRef.current.position.y = Math.sin(state.clock.elapsedTime * 0.5) * 0.1;
    }
  });

  // Calculate eclipse shadow position based on scroll
  // scrollProgress 0 -> Dark
  // scrollProgress 0.5 -> Partial
  // scrollProgress 0.8 -> Diamond Ring (Glow)
  // scrollProgress 1.0 -> Full Bright

  return (
    <group>
      <mesh ref={moonRef} castShadow receiveShadow>
        <sphereGeometry args={[2, quality === 'high' ? 64 : 32, quality === 'high' ? 64 : 32]} />
        <meshStandardMaterial
          map={moonTexture}
          roughness={0.9}
          metalness={0.1}
          bumpMap={moonTexture}
          bumpScale={0.05}
        />
      </mesh>

      {/* Diamond Ring Glow - visible at high scroll */}
      {scrollProgress > 0.7 && (
        <group position={[0, 0, -0.1]}>
           <mesh scale={1.05}>
             <sphereGeometry args={[2.05, 32, 32]} />
             <meshBasicMaterial
               color="#ffffff"
               transparent
               opacity={(scrollProgress - 0.7) * 2}
               side={THREE.BackSide}
             />
           </mesh>
           {quality === 'high' && (
             <Sparkles
               count={20}
               scale={5}
               size={6}
               speed={0.3}
               opacity={(scrollProgress - 0.8) * 5}
               color="#fff"
             />
           )}
        </group>
      )}
    </group>
  );
};

const SceneContent = ({ scrollProgress, quality }) => {
  const { viewport } = useThree();
  const isMobile = viewport.width < 5;

  // Camera animation
  const camZ = isMobile ? (10 - scrollProgress * 4) : (8 - scrollProgress * 3);
  const camY = isMobile ? (0 + scrollProgress * 1) : 0;

  // Light animation (The "Sun" causing the eclipse effect)
  // At scroll 0, light is behind the moon (backlit, silhouette)
  // At scroll 1, light is in front of the moon (full illumination)
  const lightX = Math.sin(scrollProgress * Math.PI) * 10;
  const lightZ = Math.cos(scrollProgress * Math.PI) * 10;

  // We'll use a simpler approach for the "Eclipse" look:
  // Move a directional light from back to front
  const sunPos = [
    Math.sin(scrollProgress * Math.PI - Math.PI/2) * 15,
    Math.cos(scrollProgress * Math.PI - Math.PI/2) * 5,
    Math.cos(scrollProgress * Math.PI - Math.PI/2) * 15
  ];

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, camY, camZ]} fov={isMobile ? 55 : 45} />

      {/* Ambient light increases with progress */}
      <ambientLight intensity={0.05 + scrollProgress * 0.2} />

      {/* The main Sun/Light source */}
      <directionalLight
        position={sunPos}
        intensity={0.5 + scrollProgress * 2.5}
        color={scrollProgress > 0.8 ? "#fff" : "#ffd"}
        castShadow
      />

      {/* Rim light for that "Diamond Ring" effect */}
      {scrollProgress > 0.75 && (
        <pointLight
          position={[1.5, 1.5, -1]}
          intensity={(scrollProgress - 0.75) * 20}
          color="#fff"
          distance={10}
        />
      )}

      <Float speed={1.5} rotationIntensity={0.2} floatIntensity={0.5}>
        <Moon scrollProgress={scrollProgress} quality={quality} />
      </Float>

      <Stars
        radius={100}
        depth={50}
        count={quality === 'high' ? 5000 : 2000}
        factor={4}
        saturation={0}
        fade
        speed={1}
      />

      {quality === 'high' && (
        <Environment preset="night" />
      )}

      <fog attach="fog" args={['#020617', 5, 25]} />
    </>
  );
};

const MoonScene = ({ scrollProgress }) => {
  const [quality, setQuality] = useState('high');

  return (
    <div className="w-full h-full bg-[#020617]">
      <Canvas shadows dpr={[1, 2]} gl={{ antialias: true }}>
        <PerformanceMonitor
          onDecline={() => setQuality('low')}
          onIncline={() => setQuality('high')}
        />
        <Suspense fallback={null}>
          <SceneContent scrollProgress={scrollProgress} quality={quality} />
          <BakeShadows />
        </Suspense>
      </Canvas>
    </div>
  );
};

export default MoonScene;
