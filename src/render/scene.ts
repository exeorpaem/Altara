// Mise en place commune : moteur de rendu, lumières douces, ombres, brouillard.
import * as THREE from 'three';
import { PALETTE } from './palette';

export interface SceneKit {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
}

export function createSceneKit(container: HTMLElement, opts: { shadowExtent?: number } = {}): SceneKit {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Tone mapping « neutre » : garde les pastels fidèles (ACES les délave).
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.3;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // Le fond est le dégradé CSS du <body> (renderer transparent) ;
  // le brouillard reprend la teinte du bas du ciel pour fondre l'horizon.
  scene.fog = new THREE.Fog(PALETTE.fog, 18, 42);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);

  scene.add(new THREE.HemisphereLight('#f4f1ff', '#d9c7b0', 1.1));
  const sun = new THREE.DirectionalLight('#fff4e6', 1.8);
  sun.position.set(6, 12, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 4;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  const ext = opts.shadowExtent ?? 8;
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 40 });
  scene.add(sun);

  const resize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  return { renderer, scene, camera, sun };
}
