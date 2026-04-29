import React, { useRef, useMemo, useState, useEffect, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  Float,
  Environment,
  PerspectiveCamera,
  Sparkles,
  MeshDistortMaterial,
  ContactShadows,
  PerformanceMonitor,
  BakeShadows
} from '@react-three/drei';
import * as THREE from 'three';

const RootSystem = ({ quality }) => {
  const count = quality === 'low' ? 6 : 12;
  const roots = useMemo(() => {
    return Array.from({ length: count }).map((_, i) => {
      const angle = (i / count) * Math.PI * 2;
      const radius = 0.6 + Math.random() * 1.8;
      const points = [];
      for (let j = 0; j < 5; j++) {
        const x = Math.cos(angle) * radius * (j / 4) + (Math.sin(j * 2) * 0.2);
        const y = -1.5 - (j * 0.6);
        const z = Math.sin(angle) * radius * (j / 4) + (Math.cos(j * 2) * 0.2);
        points.push(new THREE.Vector3(x, y, z));
      }
      return new THREE.CatmullRomCurve3(points);
    });
  }, [count]);

  return (
    <group>
      {roots.map((curve, i) => (
        <mesh key={i} receiveShadow>
          <tubeGeometry args={[curve, quality === 'high' ? 20 : 10, 0.07, 6, false]} />
          <meshStandardMaterial color="#2a1b0e" roughness={1} />
        </mesh>
      ))}
    </group>
  );
};

const Trunk = ({ quality }) => {
  return (
    <group>
      {/* Tapered Trunk with more segments for realism */}
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.25, 0.8, 4.5, quality === 'high' ? 24 : 12, 8]} />
        <meshStandardMaterial
          color="#3b2a1a"
          roughness={0.9}
          metalness={0.05}
        />
      </mesh>
    </group>
  );
};

const Leaf = ({ position, rotation, scale, color }) => (
  <mesh position={position} rotation={rotation} scale={scale} castShadow>
    <sphereGeometry args={[0.2, 6, 6]} />
    <meshStandardMaterial color={color} roughness={0.8} />
  </mesh>
);

const Branch = ({ position, rotation, scale = 1, quality }) => {
  const curve = useMemo(() => {
    const points = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.4, 0.7, 0.2),
      new THREE.Vector3(1.0, 1.5, -0.1),
    ];
    return new THREE.CatmullRomCurve3(points);
  }, []);

  const leaves = useMemo(() => {
    const count = quality === 'high' ? 8 : 4;
    return Array.from({ length: count }).map((_, i) => ({
      pos: [1.0 + Math.random() * 0.6, 1.5 + Math.random() * 0.6, Math.random() * 0.6 - 0.3],
      rot: [Math.random() * Math.PI, Math.random() * Math.PI, 0],
      s: 0.8 + Math.random() * 0.5,
      color: i % 2 === 0 ? "#14532d" : "#166534"
    }));
  }, [quality]);

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh castShadow>
        <tubeGeometry args={[curve, 10, 0.05, 6, false]} />
        <meshStandardMaterial color="#3b2a1a" roughness={0.9} />
      </mesh>
      {leaves.map((l, i) => (
        <Leaf key={i} position={l.pos} rotation={l.rot} scale={l.s} color={l.color} />
      ))}
    </group>
  );
};

const Tree = ({ quality }) => {
  const groupRef = useRef();

  useFrame((state) => {
    if (groupRef.current && quality === 'high') {
      groupRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.2) * 0.03;
    }
  });

  return (
    <group ref={groupRef}>
      <RootSystem quality={quality} />
      <Trunk quality={quality} />

      {/* Dynamic Branching */}
      <Branch position={[0, 0.4, 0]} rotation={[0, 0, 0.3]} scale={1.2} quality={quality} />
      <Branch position={[0, 1.2, 0]} rotation={[0, 2.1, 0.4]} scale={1.0} quality={quality} />
      <Branch position={[0, 1.9, 0]} rotation={[0, 4.2, 0.2]} scale={0.8} quality={quality} />
      <Branch position={[0, 2.5, 0]} rotation={[0, 0.8, -0.1]} scale={0.6} quality={quality} />

      {/* Apex Crown - Glowing Core of Success */}
      <group position={[0, 3.4, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[1, 32, 32]} />
          <MeshDistortMaterial
            color="#22c55e"
            speed={2}
            distort={0.2}
            radius={1}
            emissive="#064e3b"
            emissiveIntensity={0.5}
          />
        </mesh>
        <pointLight intensity={2} distance={8} color="#fbbf24" />
        {quality === 'high' && <Sparkles count={40} scale={3} size={4} speed={0.5} color="#fcd34d" />}
      </group>
    </group>
  );
};

const SceneContent = ({ scrollProgress, quality }) => {
  const { viewport } = useThree();
  const isMobile = viewport.width < 5;

  const camY = isMobile ? (-4 + scrollProgress * 9) : (-3 + scrollProgress * 7);
  const camZ = isMobile ? (10 - scrollProgress * 5) : (8 - scrollProgress * 4);

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, camY, camZ]} fov={isMobile ? 55 : 45} />
      <ambientLight intensity={0.6} />
      <directionalLight
        position={[5, 10, 5]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <pointLight position={[-5, -2, -5]} intensity={0.5} color="#3b82f6" />

      <Tree quality={quality} />

      <ContactShadows
        position={[0, -1.6, 0]}
        opacity={0.4}
        scale={15}
        blur={2}
        far={4}
      />

      {quality === 'high' && (
        <>
          <Environment preset="forest" />
          <Sparkles count={20} scale={10} size={1} speed={0.2} color="#ffffff" />
        </>
      )}

      <fog attach="fog" args={['#0f172a', 5, 20]} />
    </>
  );
};

const TreeScene = ({ scrollProgress }) => {
  const [quality, setQuality] = useState('high');

  return (
    <div className="w-full h-full">
      <Canvas shadows dpr={[1, 2]} camera={{ position: [0, -3, 8], fov: 45 }}>
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

export default TreeScene;
