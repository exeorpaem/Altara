// Page /showcase : les 3 pièces des 2 camps en rotation lente, avec M et N.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PIECES, PIECE_TYPES, type PlayerId } from '../engine/rules';
import { buildPieceMesh } from '../render/pieces';
import { createSceneKit } from '../render/scene';
import { PALETTE } from '../render/palette';

const app = document.getElementById('app')!;
const labelsEl = document.getElementById('labels')!;
const { renderer, scene, camera } = createSceneKit(app, { shadowExtent: 5 });

// Petit plateau d'exposition : disque low-poly crème.
const stage = new THREE.Mesh(
  new THREE.CylinderGeometry(4.6, 4.9, 0.3, 9),
  new THREE.MeshStandardMaterial({ color: PALETTE.sandHigh, flatShading: true, roughness: 0.9 }),
);
stage.position.y = -0.15;
stage.receiveShadow = true;
scene.add(stage);

interface Exhibit {
  pivot: THREE.Group;
  label: HTMLDivElement;
  side: THREE.Vector3;
  above: THREE.Vector3;
}
const exhibits: Exhibit[] = [];

PIECE_TYPES.forEach((type, i) => {
  ([1, 2] as PlayerId[]).forEach((player) => {
    const def = PIECES[type];
    const x = (i - 1) * 1.9;
    const z = player === 1 ? 1.1 : -1.1;

    // Petit piédestal (dalle de terrain) sous chaque pièce
    const tile = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.54, 0.12, 20),
      new THREE.MeshStandardMaterial({ color: PALETTE.sandLow, flatShading: true, roughness: 0.9 }),
    );
    tile.position.set(x, 0.06, z);
    tile.receiveShadow = true;
    scene.add(tile);

    const pivot = new THREE.Group();
    pivot.position.set(x, 0.12, z);
    pivot.rotation.y = player === 1 ? 0 : Math.PI;
    pivot.add(buildPieceMesh({ type, player }));
    scene.add(pivot);

    const label = document.createElement('div');
    label.className = 'sc-label';
    label.innerHTML =
      `<b><span class="dot" style="background:${PALETTE.camp[player]}"></span>${def.name}</b>` +
      `M ${def.movement} · F ${def.strength}`;
    labelsEl.appendChild(label);
    // Étiquettes sous les pièces du camp 1 (devant), au-dessus pour le camp 2 (derrière)
    const side = new THREE.Vector3(x, player === 1 ? -0.35 : def.visual.height + 0.55, z);
    // En vue de dessus, l'étiquette passe sous la pièce (à l'écran) pour ne pas la masquer.
    const above = new THREE.Vector3(x, 0, z + 0.8);
    exhibits.push({ pivot, label, side, above });
  });
});

// Caméra : orbite bornée (jamais sous le plateau), zoom limité.
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.5, 0);
controls.enableDamping = true;
controls.minDistance = 3;
controls.maxDistance = 14;
controls.maxPolarAngle = Math.PI * 0.47;
controls.enablePan = false;

const SIDE = new THREE.Vector3(0, 3.2, 7.6);
const TOP = new THREE.Vector3(0, 8.5, 0.01);
camera.position.copy(SIDE);
const zoom = Number(new URLSearchParams(location.search).get('zoom') || 1);
SIDE.multiplyScalar(1 / zoom);
TOP.multiplyScalar(1 / zoom);
camera.position.copy(SIDE);

// Transition animée entre les vues
let camFrom: THREE.Vector3 | null = null;
let camTo = SIDE;
let camT = 1;
function goTo(target: THREE.Vector3) {
  camFrom = camera.position.clone();
  camTo = target;
  camT = 0;
}

let spinning = true;
const btnSpin = document.getElementById('btn-spin')!;
btnSpin.onclick = () => {
  spinning = !spinning;
  btnSpin.textContent = spinning ? 'Pause rotation' : 'Reprendre rotation';
};
let topView = false;
const btnView = document.getElementById('btn-view')!;
btnView.onclick = () => {
  topView = !topView;
  goTo(topView ? TOP : SIDE);
  btnView.textContent = topView ? 'Vue de côté' : 'Vue de dessus';
};

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clock = new THREE.Clock();
const tmp = new THREE.Vector3();

function frame() {
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05);
  if (spinning) for (const e of exhibits) e.pivot.rotation.y += dt * 0.45;

  if (camFrom && camT < 1) {
    camT = Math.min(1, camT + rawDt / 0.9);
    camera.position.lerpVectors(camFrom, camTo, ease(camT));
  }
  controls.update();
  renderer.render(scene, camera);

  // Positionne les étiquettes HTML en projetant un point 3D à l'écran.
  const w = renderer.domElement.clientWidth;
  const h = renderer.domElement.clientHeight;
  for (const e of exhibits) {
    tmp.copy(camera.position.y > 6 ? e.above : e.side).project(camera);
    e.label.style.left = `${((tmp.x + 1) / 2) * w}px`;
    e.label.style.top = `${((1 - tmp.y) / 2) * h}px`;
  }
  requestAnimationFrame(frame);
}
frame();
