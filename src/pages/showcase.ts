// Page /showcase : les 3 pièces des 2 camps en rotation lente, avec M et N.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PIECES, PIECE_TYPES, type PlayerId } from '../engine/rules';
import { buildPieceMesh } from '../render/pieces';
import { buildLegacyPieceMesh } from '../render/pieces-legacy';
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

type Variant = 'new' | 'old';
interface Exhibit {
  variant: Variant;
  type: number;
  player: PlayerId;
  pivot: THREE.Group;
  tile: THREE.Mesh;
  label: HTMLDivElement;
  side: THREE.Vector3;
  above: THREE.Vector3;
}
const exhibits: Exhibit[] = [];

PIECE_TYPES.forEach((type, i) => {
  ([1, 2] as PlayerId[]).forEach((player) => {
    for (const variant of ['new', 'old'] as Variant[]) {
      const def = PIECES[type];
      // Petit piédestal (dalle de terrain) sous chaque pièce
      const tile = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.54, 0.12, 20),
        new THREE.MeshStandardMaterial({ color: PALETTE.sandLow, flatShading: true, roughness: 0.9 }),
      );
      tile.receiveShadow = true;
      scene.add(tile);

      const pivot = new THREE.Group();
      pivot.rotation.y = player === 1 ? 0 : Math.PI;
      pivot.add(variant === 'new' ? buildPieceMesh({ type, player }) : buildLegacyPieceMesh({ type, player }));
      scene.add(pivot);

      const label = document.createElement('div');
      label.className = 'sc-label';
      label.innerHTML =
        `<b><span class="dot" style="background:${PALETTE.camp[player]}"></span>${def.name}</b>` +
        `M ${def.movement} · F ${def.strength}`;
      labelsEl.appendChild(label);
      exhibits.push({ variant, type: i, player, pivot, tile, label, side: new THREE.Vector3(), above: new THREE.Vector3() });
    }
  });
});

// Mode d'affichage : nouveau design, ancien design, ou les deux côte à côte.
type Mode = 'new' | 'old' | 'both';
let mode: Mode = 'new';
const MODE_LABEL: Record<Mode, string> = { new: 'Nouveau', old: 'Ancien', both: 'Ancien / Nouveau' };
const MODE_NEXT: Record<Mode, Mode> = { new: 'old', old: 'both', both: 'new' };
const btnMode = document.getElementById('btn-mode')!;
function layout() {
  btnMode.textContent = `Design : ${MODE_LABEL[mode]}`;
  for (const e of exhibits) {
    const visible = mode === 'both' || mode === e.variant;
    e.pivot.visible = visible;
    e.tile.visible = visible;
    e.label.style.display = visible ? '' : 'none';
    const spread = mode === 'both' ? 2.4 : 1.9;
    const off = mode === 'both' ? (e.variant === 'old' ? -0.6 : 0.6) : 0;
    const x = (e.type - 1) * spread + off;
    const z = e.player === 1 ? 1.1 : -1.1;
    e.tile.position.set(x, 0.06, z);
    e.pivot.position.set(x, 0.12, z);
    const h = PIECES[PIECE_TYPES[e.type]].visual.height;
    // Étiquettes sous les pièces du camp 1 (devant), au-dessus pour le camp 2 (derrière)
    e.side.set(x, e.player === 1 ? -0.35 : h + 0.55, z);
    // En vue de dessus, l'étiquette passe sous la pièce (à l'écran) pour ne pas la masquer.
    e.above.set(x, 0, z + 0.8);
  }
}
btnMode.onclick = () => {
  mode = MODE_NEXT[mode];
  layout();
};
const qd = new URLSearchParams(location.search).get('design');
if (qd === 'old' || qd === 'both' || qd === 'new') mode = qd;
layout();

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
