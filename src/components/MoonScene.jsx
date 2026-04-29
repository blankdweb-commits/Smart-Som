import React, { useRef, useMemo, useState, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  PerspectiveCamera,
  Stars,
  Float,
  PerformanceMonitor,
  BakeShadows,
  Environment,
  Sparkles,
  Preload
} from '@react-three/drei';
import { EffectComposer, Bloom, Noise, Vignette, ChromaticAberration } from '@react-three/postprocessing';
import * as THREE from 'three';

const Moon = ({ scrollProgress, quality }) => {
  const moonRef = useRef();
  const glowRef = useRef();

  // Ultra-high-fidelity procedural moon texture
  const textures = useMemo(() => {
    const size = quality === 'high' ? 2048 : 1024;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // 1. Base Regolith color (varied greys)
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, size, size);

    // 2. Maria (Lunar Seas) - Large dark patches
    const maria = [
      { x: 0.3, y: 0.35, r: 0.2, o: 0.8 },
      { x: 0.6, y: 0.25, r: 0.15, o: 0.7 },
      { x: 0.45, y: 0.55, r: 0.25, o: 0.9 },
      { x: 0.75, y: 0.65, r: 0.12, o: 0.6 },
      { x: 0.2, y: 0.7, r: 0.18, o: 0.75 }
    ];

    maria.forEach(m => {
      const grad = ctx.createRadialGradient(m.x*size, m.y*size, 0, m.x*size, m.y*size, m.r*size);
      grad.addColorStop(0, `rgba(15,15,15,${m.o})`);
      grad.addColorStop(0.7, `rgba(12,12,12,${m.o * 0.5})`);
      grad.addColorStop(1, 'rgba(10,10,10,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(m.x*size, m.y*size, m.r*size, 0, Math.PI*2);
      ctx.fill();
    });

    // 3. Procedural Noise / Surface Grain
    const grainCount = quality === 'high' ? 15000 : 5000;
    for (let i = 0; i < grainCount; i++) {
      const lum = Math.random() * 40 + 10;
      ctx.fillStyle = `rgba(${lum},${lum},${lum},${Math.random() * 0.1})`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
    }

    // 4. Craters with depth and rims
    const craterCount = quality === 'high' ? 2000 : 800;
    for (let i = 0; i < craterCount; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = Math.random() * 12 + 1;
      const depth = Math.random() * 0.5 + 0.1;

      // Shadow (inner)
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,0,0,${depth})`;
      ctx.fill();

      // Highlight Rim (outer)
      ctx.beginPath();
      ctx.arc(x + (Math.random()-0.5)*2, y + (Math.random()-0.5)*2, r + 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(150,150,150,${depth * 0.3})`;
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // Rays for large craters
      if (r > 10 && Math.random() > 0.95) {
         ctx.strokeStyle = `rgba(200,200,200,0.05)`;
         for(let j=0; j<8; j++) {
           ctx.beginPath();
           ctx.moveTo(x, y);
           ctx.lineTo(x + Math.cos(j)*r*5, y + Math.sin(j)*r*5);
           ctx.stroke();
         }
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 16;
    return tex;
  }, []);

  useFrame((state) => {
    if (moonRef.current) {
      moonRef.current.rotation.y += 0.0003; // Very slow cinematic rotation
      moonRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.05) * 0.01;
    }
    if (glowRef.current) {
      // Subtle pulse to simulate atmospheric shimmer
      glowRef.current.scale.setScalar(1.02 + Math.sin(state.clock.elapsedTime * 0.4) * 0.01);
    }
  });

  return (
    <group>
      {/* The Core Moon Mesh */}
      <mesh ref={moonRef} castShadow receiveShadow>
        <sphereGeometry args={[2, quality === 'high' ? 128 : 64, quality === 'high' ? 128 : 64]} />
        <meshStandardMaterial
          map={textures}
          bumpMap={textures}
          bumpScale={0.15}
          roughness={0.7}
          metalness={0.02}
          color="#f1f5f9"
        />
      </mesh>

      {/* Atmospheric Glow Layer */}
      <mesh ref={glowRef} scale={1.02}>
        <sphereGeometry args={[2, 64, 64]} />
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={Math.pow(scrollProgress, 2) * 0.12}
          side={THREE.BackSide}
        />
      </mesh>

      {/* Volumetric Sparkles / Ice Dust in atmosphere */}
      {scrollProgress > 0.8 && (
        <Sparkles
          count={quality === 'high' ? 60 : 25}
          scale={7}
          size={5}
          speed={0.15}
          opacity={(scrollProgress - 0.8) * 3}
          color="#fff"
        />
      )}
    </group>
  );
};

const SceneContent = ({ scrollProgress, quality }) => {
  const { viewport, mouse } = useThree();
  const isMobile = viewport.width < 5;
  const groupRef = useRef();

  useFrame(() => {
    if (groupRef.current) {
      // Smooth parallax based on mouse
      const targetX = (mouse.x * viewport.width) / 15;
      const targetY = (mouse.y * viewport.height) / 15;
      groupRef.current.position.x += (targetX - groupRef.current.position.x) * 0.03;
      groupRef.current.position.y += (targetY - groupRef.current.position.y) * 0.03;
    }
  });

  // Eclipse Lighting Logic: Total Shadow -> Full Illumination
  // The light "Sun" travels in an arc
  const sunAngle = (scrollProgress * Math.PI) - (Math.PI / 2.2);
  const sunPos = [
    Math.sin(sunAngle) * 30,
    Math.cos(sunAngle) * 10,
    Math.cos(sunAngle) * 30
  ];

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 0, isMobile ? 11 : 9]} fov={isMobile ? 50 : 40} />

      <ambientLight intensity={0.01 + scrollProgress * 0.1} />

      {/* Primary Sunlight - creates the sharp eclipse shadow */}
      <directionalLight
        position={sunPos}
        intensity={0.1 + scrollProgress * 5}
        color="#ffffff"
        castShadow
        shadow-mapSize={quality === 'high' ? [2048, 2048] : [512, 512]}
      />

      {/* Subtle Rim / Earthshine light */}
      <pointLight
        position={[-10, 5, -5]}
        intensity={0.5 + scrollProgress * 1}
        color="#334155"
      />

      <group ref={groupRef}>
        <Moon scrollProgress={scrollProgress} quality={quality} />
      </group>

      <Stars
        radius={150}
        depth={60}
        count={quality === 'high' ? 10000 : 4000}
        factor={6}
        saturation={0}
        fade
        speed={0.3}
      />

      <Environment preset="night" />

      <EffectComposer multisampling={quality === 'high' ? 8 : 0}>
        {quality === 'high' && (
          <Bloom
            intensity={0.4 + scrollProgress * 1.6}
            luminanceThreshold={0.15}
            luminanceSmoothing={0.8}
            mipmapBlur
          />
        )}
        {quality === 'high' && <ChromaticAberration offset={[0.0008, 0.0008]} />}
        {quality === 'high' && <Noise opacity={0.03} />}
        {quality === 'high' && <Vignette eskil={false} offset={0.05} darkness={1.2} />}
      </EffectComposer>

      <fog attach="fog" args={['#020617', 5, 40]} />
    </>
  );
};

const MoonScene = ({ scrollProgress }) => {
  const [quality, setQuality] = useState('high');

  return (
    <div className="w-full h-full bg-[#020617]">
      <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
        dpr={[1, quality === 'high' ? 2 : 1.5]}
        gl={{
          antialias: false,
          stencil: false,
          depth: true,
          powerPreference: "high-performance",
          logarithmicDepthBuffer: false
        }}
      >
        <PerformanceMonitor
          onDecline={() => setQuality('low')}
          onIncline={() => setQuality('high')}
        />
        <Suspense fallback={<group><mesh><sphereGeometry args={[1, 16, 16]} /><meshBasicMaterial color="#020617" /></mesh></group>}>
          <SceneContent scrollProgress={scrollProgress} quality={quality} />
          <BakeShadows />
          <Preload all />
        </Suspense>
      </Canvas>
    </div>
  );
};

export default MoonScene;
