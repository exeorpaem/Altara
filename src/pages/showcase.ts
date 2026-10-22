// Page /showcase : les 3 pièces des 2 camps, avec M et N, pour chaque style de pièces.
// Sélecteur de style (Actuel, propositions) et mode « Tout comparer » (grille :
// une rangée par style). Paramètres d'URL : ?style=<id>|all · ?view=top · ?spin=0 · ?zoom=<k>.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PIECES, PIECE_TYPES, type PlayerId } from '../engine/rules';
import { DEFAULT_STYLE_ID, PIECE_STYLES, type PieceBuilder } from '../render/pieces-styles';
import { createSceneKit } from '../render/scene';
import { PALETTE } from '../render/palette';

const app = document.getElementById('app')!;
const labelsEl = document.getElementById('labels')!;
const { renderer, scene, camera } = createSceneKit(app, { shadowExtent: 6 });
const params = new URLSearchParams(location.search);

// Styles montrés : ceux du jeu (registre) + l'ancien design, pour mémoire.
const STYLES: { id: string; name: string; build: PieceBuilder }[] = [
  ...PIECE_STYLES,
];

// Plateau d'exposition : disque low-poly crème (agrandi en mode grille).
const stage = new THREE.Mesh(
  new THREE.CylinderGeometry(4.6, 4.9, 0.3, 9),
  new THREE.MeshStandardMaterial({ color: PALETTE.sandHigh, flatShading: true, roughness: 0.9 }),
);
stage.position.y = -0.15;
stage.receiveShadow = true;
scene.add(stage);

const tileGeo = new THREE.CylinderGeometry(0.5, 0.54, 0.12, 20);
const tileMat = new THREE.MeshStandardMaterial({ color: PALETTE.sandLow, flatShading: true, roughness: 0.9 });

interface Exhibit {
  style: number;
  type: number;
  player: PlayerId;
  pivot: THREE.Group;
  tile: THREE.Mesh;
  label: HTMLDivElement;
  side: THREE.Vector3;
  above: THREE.Vector3;
}
const exhibits: Exhibit[] = [];
const rowLabels: { el: HTMLDivElement; pos: THREE.Vector3 }[] = [];

STYLES.forEach((style, si) => {
  PIECE_TYPES.forEach((type, i) => {
    ([1, 2] as PlayerId[]).forEach((player) => {
      const def = PIECES[type];
      const tile = new THREE.Mesh(tileGeo, tileMat);
      tile.receiveShadow = true;
      scene.add(tile);
      const pivot = new THREE.Group();
      pivot.rotation.y = player === 1 ? 0 : Math.PI;
      pivot.add(style.build({ type, player }));
      scene.add(pivot);
      const label = document.createElement('div');
      label.className = 'sc-label';
      label.innerHTML =
        `<b><span class="dot" style="background:${PALETTE.camp[player]}"></span>${def.name}</b>` +
        `M ${def.movement} · F ${def.strength}`;
      labelsEl.appendChild(label);
      exhibits.push({ style: si, type: i, player, pivot, tile, label, side: new THREE.Vector3(), above: new THREE.Vector3() });
    });
  });
  const el = document.createElement('div');
  el.className = 'sc-label sc-row';
  el.innerHTML = `<b>${style.name}</b>`;
  labelsEl.appendChild(el);
  rowLabels.push({ el, pos: new THREE.Vector3() });
});

// Sélecteur : un style, ou « all » (grille).
const sel = document.getElementById('sel-style') as HTMLSelectElement;
for (const s of STYLES) sel.add(new Option(s.name, s.id));
sel.add(new Option('Tout comparer', 'all'));
let current = params.get('style') ?? DEFAULT_STYLE_ID;
if (!STYLES.some((s) => s.id === current) && current !== 'all') current = DEFAULT_STYLE_ID;

const SIDE = new THREE.Vector3(0, 3.2, 7.6);
const TOP = new THREE.Vector3(0, 8.5, 0.01);
const GRID_SIDE = new THREE.Vector3(0, 7.5, 9.5);
const GRID_TOP = new THREE.Vector3(0, 13, 0.01);
const zoom = Number(params.get('zoom') || 1);
let topView = params.get('view') === 'top';

function layout() {
  sel.value = current;
  const grid = current === 'all';
  stage.scale.set(grid ? 1.45 : 1, 1, grid ? 1.45 : 1);
  for (const e of exhibits) {
    const visible = grid || STYLES[e.style].id === current;
    e.pivot.visible = visible;
    e.tile.visible = visible;
    e.label.style.display = visible && !grid ? '' : 'none';
    const h = PIECES[PIECE_TYPES[e.type]].visual.height;
    let x: number, z: number;
    if (grid) {
      // Colonnes : E1 E2 A1 A2 S1 S2 ; rangées : un style chacune.
      x = (e.type * 2 + (e.player - 1) - 2.5) * 1.12;
      z = (e.style - (STYLES.length - 1) / 2) * 1.55;
    } else {
      x = (e.type - 1) * 1.9;
      z = e.player === 1 ? 1.1 : -1.1;
    }
    e.tile.position.set(x, 0.06, z);
    e.pivot.position.set(x, 0.12, z);
    e.side.set(x, e.player === 1 ? -0.35 : h + 0.55, z);
    e.above.set(x, 0, z + 0.8);
  }
  rowLabels.forEach((r, si) => {
    r.el.style.display = grid ? '' : 'none';
    r.pos.set(-4.1, 0.1, (si - (STYLES.length - 1) / 2) * 1.55);
  });
  goTo(view());
}
function view(): THREE.Vector3 {
  const grid = current === 'all';
  const v = (grid ? (topView ? GRID_TOP : GRID_SIDE) : topView ? TOP : SIDE).clone();
  return v.multiplyScalar(1 / zoom);
}
sel.onchange = () => {
  current = sel.value;
  const u = new URL(location.href);
  u.searchParams.set('style', current);
  history.replaceState(null, '', u);
  layout();
};

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.5, 0);
controls.enableDamping = true;
controls.minDistance = 3;
controls.maxDistance = 22;
controls.maxPolarAngle = Math.PI * 0.47;
controls.enablePan = false;

// Transition animée entre les vues
let camFrom: THREE.Vector3 | null = null;
let camTo = view();
let camT = 1;
camera.position.copy(camTo);
function goTo(target: THREE.Vector3) {
  camFrom = camera.position.clone();
  camTo = target;
  camT = 0;
}

let spinning = params.get('spin') !== '0';
const btnSpin = document.getElementById('btn-spin')!;
const spinText = () => (btnSpin.textContent = spinning ? 'Pause rotation' : 'Reprendre rotation');
spinText();
btnSpin.onclick = () => {
  spinning = !spinning;
  spinText();
};
const btnView = document.getElementById('btn-view')!;
const viewText = () => (btnView.textContent = topView ? 'Vue de côté' : 'Vue de dessus');
viewText();
btnView.onclick = () => {
  topView = !topView;
  goTo(view());
  viewText();
};
layout();
camera.position.copy(view());
camT = 1;

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

  // Étiquettes HTML : projection d'un point 3D à l'écran.
  const w = renderer.domElement.clientWidth;
  const h = renderer.domElement.clientHeight;
  const place = (el: HTMLElement, p: THREE.Vector3) => {
    tmp.copy(p).project(camera);
    el.style.left = `${((tmp.x + 1) / 2) * w}px`;
    el.style.top = `${((1 - tmp.y) / 2) * h}px`;
  };
  const high = camera.position.y > camera.position.length() * 0.8;
  for (const e of exhibits) if (e.label.style.display !== 'none') place(e.label, high ? e.above : e.side);
  for (const r of rowLabels) if (r.el.style.display !== 'none') place(r.el, r.pos);
  requestAnimationFrame(frame);
}
frame();
