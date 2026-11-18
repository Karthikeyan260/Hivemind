// Minimal types for the n8ao package (it ships none): the pass Mission Control uses with three's EffectComposer.
declare module "n8ao" {
  import type { Camera, Scene } from "three";
  import { Pass } from "three/addons/postprocessing/Pass.js";
  export class N8AOPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: { aoRadius: number; distanceFalloff: number; intensity: number; halfRes: boolean; aoSamples: number; denoiseSamples: number; denoiseRadius: number; screenSpaceRadius: boolean };
    setQualityMode(mode: "Performance" | "Low" | "Medium" | "High" | "Ultra"): void;
    setSize(width: number, height: number): void;
  }
}
