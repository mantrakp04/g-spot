import { ContactShadows, Environment, Float, Lightformer } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";

const C = {
  teal: "#9ad6cf",
  mauve: "#cba9b8",
  mauveDeep: "#b98ea2",
  violet: "#7d5bc6",
  violetDeep: "#5a3f9e",
};

const EXTRUDE_DEPTH = 0.42;
const HOLE_RADIUS = 0.52;
const HOLE_SEGMENTS = 144;

const BANDS = [
  { outer: 2.04, inner: 1.88, color: C.teal, lift: 0 },
  { outer: 1.88, inner: 1.36, color: C.mauve, lift: 0.012 },
  { outer: 1.36, inner: 1.1, color: C.violet, lift: 0.026 },
  { outer: 1.1, inner: 0.82, color: C.mauveDeep, lift: 0.04 },
  { outer: 0.82, inner: "wavy-hole", color: C.violetDeep, lift: 0.055 },
] as const;

function BrandMaterial({
  color,
  ...extra
}: { color: string } & Partial<THREE.MeshPhysicalMaterialParameters>) {
  return (
    <meshPhysicalMaterial
      color={color}
      roughness={0.24}
      metalness={0.04}
      clearcoat={1}
      clearcoatRoughness={0.26}
      iridescence={0.32}
      iridescenceIOR={1.28}
      sheen={0.58}
      sheenColor="#ffffff"
      envMapIntensity={1.28}
      {...extra}
    />
  );
}

function circlePoints(radius: number, segments = HOLE_SEGMENTS) {
  return Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius);
  });
}

function wavyHolePoints(clockwise = true) {
  return Array.from({ length: HOLE_SEGMENTS }, (_, index) => {
    const progress = index / HOLE_SEGMENTS;
    const angle = -Math.PI / 2 + (clockwise ? -progress : progress) * Math.PI * 2;
    const radius =
      HOLE_RADIUS +
      Math.sin(angle * 5 + 0.5) * 0.085 +
      Math.sin(angle * 2 - 0.9) * 0.035 +
      Math.cos(angle * 7 + 1.1) * 0.018;

    return new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius);
  });
}

function closedPath(points: THREE.Vector2[]) {
  const path = new THREE.Path();
  path.moveTo(points[0].x, points[0].y);

  for (let index = 1; index < points.length; index += 1) {
    path.lineTo(points[index].x, points[index].y);
  }

  path.closePath();
  return path;
}

function createBandGeometry(outerRadius: number, innerRadius: number | "wavy-hole") {
  const shape = new THREE.Shape(circlePoints(outerRadius));
  const innerPoints =
    innerRadius === "wavy-hole" ? wavyHolePoints(true) : circlePoints(innerRadius).reverse();

  shape.holes.push(closedPath(innerPoints));

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: EXTRUDE_DEPTH,
    steps: 2,
    bevelEnabled: true,
    bevelThickness: 0.075,
    bevelSize: 0.055,
    bevelSegments: 9,
    curveSegments: 96,
  });

  geometry.center();
  geometry.computeVertexNormals();
  return geometry;
}

function LogoMark() {
  const geometries = useMemo(
    () => BANDS.map((band) => createBandGeometry(band.outer, band.inner)),
    [],
  );

  return (
    <group scale={0.94}>
      {BANDS.map((band, index) => (
        <mesh
          key={`${band.color}-${band.outer}`}
          geometry={geometries[index]}
          position={[0, 0, band.lift]}
          castShadow
          receiveShadow
        >
          <BrandMaterial
            color={band.color}
            clearcoatRoughness={index === 0 ? 0.34 : 0.24}
            iridescence={index === BANDS.length - 1 ? 0.46 : 0.32}
          />
        </mesh>
      ))}
    </group>
  );
}

function ParallaxRig({ children }: { children: ReactNode }) {
  const group = useRef<THREE.Group>(null);

  useFrame((state, delta) => {
    if (!group.current) return;

    group.current.rotation.x = THREE.MathUtils.damp(
      group.current.rotation.x,
      -state.pointer.y * 0.16,
      4.2,
      delta,
    );
    group.current.rotation.y = THREE.MathUtils.damp(
      group.current.rotation.y,
      state.pointer.x * 0.22,
      4.2,
      delta,
    );
  });

  return <group ref={group}>{children}</group>;
}

function Lights() {
  return (
    <Environment resolution={256}>
      <Lightformer intensity={2.4} position={[0, 2.6, 3.2]} scale={[5.5, 5.5, 1]} color="#ffffff" />
      <Lightformer intensity={1.5} position={[-3, 1.2, 2]} scale={[3, 3, 1]} color="#d7b2c4" />
      <Lightformer intensity={1.35} position={[3, -1.1, 1.8]} scale={[3.4, 2.4, 1]} color="#9ad6cf" />
      <Lightformer intensity={0.85} position={[0, -3, 2]} scale={[5, 2, 1]} color="#f4f1ea" />
    </Environment>
  );
}

export default function HeroLogo3D({ reduced = false }: { reduced?: boolean }) {
  return (
    <Canvas
      camera={{ position: [0, 0, 8.2], fov: 34 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      shadows
      style={{ background: "transparent" }}
    >
      <ambientLight intensity={0.46} />
      <directionalLight position={[3.2, 4.4, 5]} intensity={1.25} castShadow />
      <Suspense fallback={null}>
        <Lights />
        {reduced ? (
          <LogoMark />
        ) : (
          <Float speed={1.15} rotationIntensity={0.12} floatIntensity={0.36}>
            <ParallaxRig>
              <LogoMark />
            </ParallaxRig>
          </Float>
        )}
        <ContactShadows
          position={[0, -2.05, 0]}
          opacity={0.28}
          scale={7.5}
          blur={2.8}
          far={4}
          color="#5a3f9e"
        />
      </Suspense>
    </Canvas>
  );
}
