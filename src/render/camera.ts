// Caméra orbitale bornée + transitions animées entre vues prédéfinies.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface CameraRig {
  controls: OrbitControls;
  /** Vue par défaut, placée derrière le joueur indiqué (1 = depuis le bas, 2 = depuis le haut). */
  defaultView(player?: 1 | 2): void;
  topView(): void;
  update(dt: number): void;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export function createCameraRig(camera: THREE.PerspectiveCamera, dom: HTMLElement): CameraRig {
  const controls = new OrbitControls(camera, dom);
  controls.target.set(0, 0.8, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 8;
  controls.maxDistance = 26;
  controls.minPolarAngle = 0.001;
  controls.maxPolarAngle = 1.2; // ≈ 69° : la caméra ne passe jamais sous le plateau

  // Animation en coordonnées sphériques autour de la cible : la caméra « tourne »
  // autour du plateau au lieu de le traverser en ligne droite.
  const from = new THREE.Spherical();
  const to = new THREE.Spherical();
  let t = 1;
  const offset = new THREE.Vector3();

  function goTo(radius: number, phi: number, theta: number) {
    offset.copy(camera.position).sub(controls.target);
    from.setFromVector3(offset);
    to.set(radius, phi, theta);
    // Chemin angulaire le plus court
    while (to.theta - from.theta > Math.PI) to.theta -= Math.PI * 2;
    while (to.theta - from.theta < -Math.PI) to.theta += Math.PI * 2;
    t = 0;
  }

  const rig: CameraRig = {
    controls,
    defaultView(player = 1) {
      goTo(16, 0.95, player === 1 ? 0 : Math.PI);
    },
    topView() {
      offset.copy(camera.position).sub(controls.target);
      const theta = new THREE.Spherical().setFromVector3(offset).theta;
      // On garde l'orientation actuelle (θ) pour ne pas désorienter le joueur.
      goTo(19, 0.001, theta);
    },
    update(dt) {
      if (t < 1) {
        t = Math.min(1, t + dt / 0.9);
        const k = ease(t);
        const s = new THREE.Spherical(
          THREE.MathUtils.lerp(from.radius, to.radius, k),
          THREE.MathUtils.lerp(from.phi, to.phi, k),
          THREE.MathUtils.lerp(from.theta, to.theta, k),
        );
        camera.position.setFromSpherical(s).add(controls.target);
        camera.lookAt(controls.target);
      }
      controls.update();
    },
  };

  camera.position.setFromSpherical(new THREE.Spherical(16, 0.95, 0)).add(controls.target);
  return rig;
}
