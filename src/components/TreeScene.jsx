import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Environment, PerspectiveCamera, Sparkles, MeshDistortMaterial, MeshWobbleMaterial } from '@react-three/drei';
import * as THREE from 'three';

const RootSystem = () => {
  const count = 20;
  const roots = useMemo(() => {
    return Array.from({ length: count }).map((_, i) => {
      const angle = (i / count) * Math.PI * 2;
      const radius = 0.8 + Math.random() * 2;
      const points = [];
      for (let j = 0; j < 8; j++) {
        const x = Math.cos(angle) * radius * (j / 7) + (Math.sin(j * 2) * 0.2);
        const y = -1.5 - (j * 0.4) - (Math.random() * 0.3);
        const z = Math.sin(angle) * radius * (j / 7) + (Math.cos(j * 2) * 0.2);
        points.push(new THREE.Vector3(x, y, z));
      }
      return new THREE.CatmullRomCurve3(points);
    });
  }, []);

  return (
    <group>
      {roots.map((curve, i) => (
        <mesh key={i} receiveShadow>
          <tubeGeometry args={[curve, 32, 0.06, 8, false]} />
          <meshStandardMaterial color="#3d2b1f" roughness={1} />
        </mesh>
      ))}
      {/* Underground particle glow */}
      <Sparkles count={40} scale={[4, 2, 4]} size={1} speed={0.2} position={[0, -3, 0]} color="#fbbf24" />
    </group>
  );
};

const Trunk = () => {
  const trunkRef = useRef();

  useFrame((state) => {
    if (trunkRef.current) {
      // Subtle pulse effect
      const s = 1 + Math.sin(state.clock.elapsedTime * 2) * 0.01;
      trunkRef.current.scale.set(s, 1, s);
    }
  });

  return (
    <group ref={trunkRef}>
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.35, 0.85, 4.5, 20, 10]} />
        <meshStandardMaterial color="#4a3728" roughness={0.9} metalness={0.1} />
      </mesh>
      {/* Internal Pulse Glow */}
      <pointLight position={[0, 0.5, 0]} color="#3b82f6" intensity={0.5} distance={2} />
    </group>
  );
};

const Branch = ({ position, rotation, scale = 1, delay = 0 }) => {
  const curve = useMemo(() => {
    const points = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.6, 0.9, 0.3),
      new THREE.Vector3(1.4, 1.8, -0.2),
    ];
    return new THREE.CatmullRomCurve3(points);
  }, []);

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh castShadow>
        <tubeGeometry args={[curve, 15, 0.07, 8, false]} />
        <meshStandardMaterial color="#4a3728" />
      </mesh>
      {/* Clustered Leaves */}
      <Float speed={1.5 + Math.random()} rotationIntensity={0.6} floatIntensity={0.6}>
        <group position={[1.4, 1.9, 0]}>
          {[...Array(5)].map((_, i) => (
            <mesh key={i} position={[Math.random() * 0.4, Math.random() * 0.4, Math.random() * 0.4]} castShadow>
              <sphereGeometry args={[0.25, 6, 6]} />
              <meshStandardMaterial color="#166534" roughness={0.6} />
            </mesh>
          ))}
          {/* Subtle healing symbols (subtle glowing crosses) */}
          <Sparkles count={3} scale={0.5} size={3} speed={0.5} color="#4ade80" />
        </group>
      </Float>
    </group>
  );
};

const Tree = ({ scrollProgress }) => {
  const groupRef = useRef();

  useFrame((state) => {
    if (!groupRef.current) return;
    // Rotation based on time for life feel
    groupRef.current.rotation.y = Math.sin(state.clock.getElapsedTime() * 0.2) * 0.1;
  });

  return (
    <group ref={groupRef}>
      <RootSystem />
      <Trunk />

      {/* Vascular-like branching */}
      <Branch position={[0, 0.2, 0]} rotation={[0, 0, 0.2]} />
      <Branch position={[0, 0.8, 0]} rotation={[0, Math.PI * 0.5, 0.3]} scale={0.85} />
      <Branch position={[0, 1.4, 0]} rotation={[0, Math.PI, 0.1]} scale={0.7} />
      <Branch position={[0, 1.9, 0]} rotation={[0, Math.PI * 1.5, -0.2]} scale={0.6} />
      <Branch position={[0, 0.6, 0]} rotation={[0.2, -0.5, -0.4]} scale={0.5} />

      {/* Apex Crown - The Graduation Cap / Higher State */}
      <group position={[0, 2.8, 0]}>
        <Sparkles count={100} scale={4} size={3} speed={0.6} color="#fcd34d" />
        <mesh castShadow>
          <sphereGeometry args={[1, 32, 32]} />
          <MeshDistortMaterial
            color="#22c55e"
            speed={3}
            distort={0.25}
            radius={1}
            emissive="#166534"
            emissiveIntensity={0.2}
          />
        </mesh>
        <pointLight intensity={2} distance={5} color="#fbbf24" />
      </group>
    </group>
  );
};

const TreeScene = ({ scrollProgress }) => {
  // Camera journey from underground to apex
  // Start: -3 (Roots), End: 3.5 (Crown)
  const camY = -3 + scrollProgress * 7;
  const camZ = 7 - scrollProgress * 3;
  const lookAtY = camY + 1; // Look slightly up

  return (
    <div className="w-full h-full">
      <Canvas shadows dpr={[1, 2]}>
        <PerspectiveCamera makeDefault position={[0, camY, camZ]} fov={45} />

        <ambientLight intensity={0.4} />
        <pointLight position={[-10, -10, -10]} color="#4b2c20" intensity={0.5} />
        <spotLight
          position={[5, 10, 5]}
          intensity={2}
          angle={0.4}
          penumbra={1}
          castShadow
          shadow-mapSize={[1024, 1024]}
        />

        {/* Dynamic Sunlight */}
        <directionalLight
          position={[0, 10, 0]}
          intensity={scrollProgress * 2}
          color="#fef3c7"
        />

        <Tree scrollProgress={scrollProgress} />

        <Environment preset="sunset" />
        <fog attach="fog" args={['#0f172a', 2, 20]} />
      </Canvas>
    </div>
  );
};

export default TreeScene;
