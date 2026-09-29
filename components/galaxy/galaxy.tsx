"use client";

import { useEffect, useRef } from "react";
import { type GNode, type GProject, GalaxyScene } from "./scene";

export type { GNode, GProject };

/** Mounts the WebGL galaxy and hands the scene instance to the parent for imperative control. */
export function Galaxy({
  onReady,
  onHover,
  onSelectNode,
  onSelectProject,
  dimLabels = false,
}: {
  dimLabels?: boolean;
  onReady: (scene: GalaxyScene | null) => void;
  onHover: (node: GNode | null, x: number, y: number) => void;
  onSelectNode: (node: GNode) => void;
  onSelectProject: (p: GProject | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const reticlesRef = useRef<HTMLDivElement>(null);
  const cbRef = useRef({ onHover, onSelectNode, onSelectProject });

  useEffect(() => {
    cbRef.current = { onHover, onSelectNode, onSelectProject };
  });

  useEffect(() => {
    let scene: GalaxyScene | null = null;
    try {
      scene = new GalaxyScene(canvasRef.current!, labelsRef.current!, reticlesRef.current!, {
        onHover: (n, x, y) => cbRef.current.onHover(n, x, y),
        onSelectNode: (n) => cbRef.current.onSelectNode(n),
        onSelectProject: (p) => cbRef.current.onSelectProject(p),
      });
    } catch (err) {
      console.warn("WebGL unavailable:", err);
    }
    onReady(scene);
    const ro = new ResizeObserver(() => scene?.resize());
    ro.observe(canvasRef.current!);
    return () => {
      ro.disconnect();
      scene?.dispose();
      onReady(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  return (
    <div className="absolute inset-0">
      <canvas ref={canvasRef} className="block h-full w-full touch-none" aria-label="Your knowledge as a 3D galaxy. Drag to orbit, scroll to zoom." />
      <div ref={reticlesRef} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" />
      <div
        ref={labelsRef}
        className="pointer-events-none absolute inset-0 overflow-hidden transition-opacity duration-500 [&>*]:pointer-events-auto"
        style={{ opacity: dimLabels ? 0.18 : 1 }}
      />
    </div>
  );
}
