import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/**
 * Real assets for Mission Control (all CC0 from Poly Haven, see public/hq/SOURCES.md): photo textures for the floor,
 * walls, desks and steel, and real furniture models. Textures and models load once and are shared; a model is placed
 * into an empty group straight away and fills in when its file arrives, so building the hall never waits on a download.
 */

const textureLoader = new THREE.TextureLoader();
const textures = new Map<string, THREE.Texture>();

function tex(id: string, kind: "diff" | "nor" | "rough", repeat: number) {
  const key = `${id}/${kind}@${repeat}`;
  let t = textures.get(key);
  if (!t) {
    t = textureLoader.load(`/hq/textures/${id}/${kind}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 8;
    if (kind === "diff") t.colorSpace = THREE.SRGBColorSpace;
    textures.set(key, t);
  }
  return t;
}

export type Surface = "concrete_floor" | "oak" | "concrete_wall" | "steel_plate";
const SURFACE: Record<Surface, string> = { concrete_floor: "hangar_concrete_floor", oak: "oak_veneer_01", concrete_wall: "concrete_wall_008", steel_plate: "metal_plate" };

/** Gives a material a real surface: colour, normal and roughness maps, tiled `repeat` times. `tint` multiplies the photo. */
export function surface(mat: THREE.MeshStandardMaterial, kind: Surface, repeat = 1, tint = "#ffffff") {
  const id = SURFACE[kind];
  mat.map = tex(id, "diff", repeat);
  mat.normalMap = tex(id, "nor", repeat);
  mat.roughnessMap = tex(id, "rough", repeat);
  mat.roughness = 1;
  mat.color.set(tint);
  mat.needsUpdate = true;
  return mat;
}

const MODELS = {
  desk: "metal_office_desk/metal_office_desk_1k.gltf",
  lamp: "desk_lamp_arm_01/desk_lamp_arm_01_1k.gltf",
  plant: "potted_plant_02/potted_plant_02_1k.gltf",
  cabinet: "drawer_cabinet/drawer_cabinet_1k.gltf",
  rack: "worn_metal_rack/worn_metal_rack_1k.gltf",
  armchair: "modern_arm_chair_01/modern_arm_chair_01_1k.gltf",
  books: "book_encyclopedia_set_01/book_encyclopedia_set_01_1k.gltf",
} as const;
export type ModelName = keyof typeof MODELS;

const gltf = new GLTFLoader();
const models = new Map<ModelName, Promise<THREE.Object3D | null>>();
function load(name: ModelName) {
  let p = models.get(name);
  if (!p) {
    p = gltf.loadAsync(`/hq/models/${MODELS[name]}`).then(
      (g) => {
        g.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
          }
        });
        return g.scene;
      },
      () => null, // a model that can't load just leaves its spot empty
    );
    models.set(name, p);
  }
  return p;
}

/**
 * Puts a real model at (x, y, z) in `parent`, turned by `yaw`, sitting on y. Sized by `width` (its widest side) or
 * `height`, or by `scale` (1 = real size: the files are in metres, like the hall).
 */
export function placeModel(parent: THREE.Object3D, name: ModelName, at: { x: number; y?: number; z: number; yaw?: number; width?: number; height?: number; scale?: number }) {
  const slot = new THREE.Group();
  slot.position.set(at.x, at.y ?? 0, at.z);
  slot.rotation.y = at.yaw ?? 0;
  parent.add(slot);
  void load(name).then((src) => {
    if (!src) return;
    const m = src.clone(true);
    const box = new THREE.Box3().setFromObject(m);
    const size = box.getSize(new THREE.Vector3());
    let k = at.scale ?? 1;
    if (at.width) k = at.width / Math.max(size.x, size.z, 1e-3);
    else if (at.height) k = at.height / Math.max(size.y, 1e-3);
    m.scale.setScalar(k);
    const c = box.getCenter(new THREE.Vector3());
    m.position.set(-c.x * k, -box.min.y * k, -c.z * k);
    slot.add(m);
  });
  return slot;
}
