"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import type { RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { getMorphPoints, HERO_MORPH_POINT_COUNT } from "./morph-geometry";
import { readCssColor } from "./read-css-color";

export interface HeroMorphSceneProps {
  /**
   * 0-1 scroll progress, read every `useFrame` tick via a ref — never
   * React state (WEBSITE_CREATIVE_BRIEF.md §3: "read from ScrollTrigger's
   * own progress value... not from React state, to avoid re-render
   * cost"). The caller (`hero-scroll-scene.tsx`) fills this from
   * `useScrollProgress`'s `onUpdate`.
   */
  progressRef: RefObject<number>;
  className?: string;
  /** Design-token CSS custom property for the line's color (`read-css-color.ts`). */
  strokeColorVar?: string;
}

const MAX_DPR = 2;

/**
 * The one `THREE.Line` object the hero's flagship morph is — authored as
 * a single continuous line (WEBSITE_CREATIVE_BRIEF.md §3: "ONE
 * `THREE.Line`/`THREE.TubeGeometry` object"), not an `InstancedMesh`:
 * there is exactly one of it on screen at a time, so instancing has
 * nothing to batch. Its position buffer is mutated in place every frame
 * (`positionAttr.setXYZ` + `needsUpdate`) instead of recreating
 * geometry/passing new React props, which is what keeps this a
 * zero-re-render animation loop.
 */
function HeroMorphLine({ progressRef, color }: { progressRef: RefObject<number>; color: string }) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(HERO_MORPH_POINT_COUNT * 3), 3),
    );
    return geo;
  }, []);

  const material = useMemo(() => new THREE.LineBasicMaterial({ color }), [color]);

  const line = useMemo(() => new THREE.Line(geometry, material), [geometry, material]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame(() => {
    const points = getMorphPoints(progressRef.current ?? 0);
    const positionAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      if (!point) continue;
      positionAttr.setXYZ(i, point[0], point[1], 0);
    }
    positionAttr.needsUpdate = true;
  });

  return <primitive object={line} />;
}

/**
 * The hero set piece's WebGL tier (desktop/tablet, device-qualified —
 * gated by `<LazyWebglBoundary>`, never mounted directly). Renders the
 * flagship morph object inside its own orthographic `<Canvas>` — a flat
 * line-art object has no use for perspective — capped to `MAX_DPR` and
 * paused (`frameloop="never"`) whenever this scene leaves the viewport
 * or the tab is hidden (WEBSITE_CREATIVE_BRIEF.md §6 step 8's runtime
 * GPU discipline: cap DPR, pause the render loop offscreen, dynamic
 * quality scaling — DPR/pause are implemented here; segment-count
 * scaling on a detected frame-rate drop is a documented follow-up, see
 * `docs/audit/SITE_REQUESTS.md`). r3f disposes every scene object on
 * unmount by default; `HeroMorphLine` also disposes its own
 * geometry/material explicitly as a second, redundant safety net.
 */
export function HeroMorphScene({
  progressRef,
  className,
  strokeColorVar = "--accent-500",
}: HeroMorphSceneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [color, setColor] = useState("rgb(0, 0, 0)");
  const [frameloop, setFrameloop] = useState<"always" | "never">("always");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- readCssColor() needs a real mounted `document`/DOM element to resolve the computed color (see read-css-color.ts); cannot run during SSR or in a lazy initializer
    setColor(readCssColor(strokeColorVar));
  }, [strokeColorVar]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateFromVisibility = () => {
      setFrameloop(document.hidden ? "never" : "always");
    };

    const intersectionObserver =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(
            (entries) => {
              const intersecting = entries[0]?.isIntersecting ?? true;
              setFrameloop(intersecting && !document.hidden ? "always" : "never");
            },
            { threshold: 0 },
          )
        : undefined;
    intersectionObserver?.observe(element);
    document.addEventListener("visibilitychange", updateFromVisibility);

    return () => {
      intersectionObserver?.disconnect();
      document.removeEventListener("visibilitychange", updateFromVisibility);
    };
  }, []);

  return (
    <div ref={containerRef} className={className} aria-hidden="true">
      <Canvas
        orthographic
        dpr={[1, MAX_DPR]}
        // r3f's default orthographic frustum is exactly the canvas's CSS
        // pixel size (`camera.left/right/top/bottom = ±size.width/2,
        // ±size.height/2` — @react-three/fiber's own camera setup), so
        // the world-space view is `size.width/zoom` × `size.height/zoom`.
        // The authored morph geometry (`morph-geometry.ts`) spans
        // x:[-1.1,1.1]/y:[-0.4,0.4] across its four keyframes (2.2 × 0.8
        // world units) — this hero visual's box
        // (`hero-scroll-section.tsx`'s `HERO_VISUAL_CLASSNAME`) is
        // ~450-650px wide at every qualifying viewport, so `zoom: 170`
        // renders the line at ~375-390px wide (2.2 × 170), comfortably
        // inside even the narrowest box with margin on every side, at
        // every stage of the morph.
        camera={{ position: [0, 0, 10], zoom: 170 }}
        gl={{ antialias: true, alpha: true }}
        frameloop={frameloop}
      >
        <HeroMorphLine progressRef={progressRef} color={color} />
      </Canvas>
    </div>
  );
}

export default HeroMorphScene;
