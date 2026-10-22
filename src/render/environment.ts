// Décor : île flottante sous le plateau et nuages qui dérivent.
import * as THREE from 'three';
import { mulberry32 } from '../engine/random';
import type { Skin } from './skins';

/**
 * Île flottante : une dalle chanfreinée sous le plateau, prolongée par un
 * cône rocheux renversé dont on bouscule les sommets pour l'aspect low-poly.
 */
export function buildIsland(boardSize: number, skin: Skin): THREE.Group {
  const rand = mulberry32(7);
  const g = new THREE.Group();
  const half = boardSize / 2 + 0.55;

  const slab = new THREE.Mesh(
    new THREE.CylinderGeometry(half * Math.SQRT2, half * Math.SQRT2 * 0.96, 0.5, 4, 1),
    new THREE.MeshStandardMaterial({ color: skin.slab, flatShading: true, roughness: 1 }),
  );
  slab.rotation.y = Math.PI / 4; // le carré à 4 côtés s'aligne sur le plateau
  slab.position.y = -0.25;
  slab.receiveShadow = true;
  g.add(slab);

  const rockGeo = new THREE.ConeGeometry(half * 1.3, 6, 9, 4, false);
  rockGeo.rotateX(Math.PI); // pointe vers le bas
  const pos = rockGeo.attributes.position as THREE.BufferAttribute;
  // On décale chaque sommet de façon déterministe. Les sommets confondus (couture
  // du cône) doivent bouger pareil : on dérive le décalage de leur position.
  const jitter = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!jitter.has(key)) jitter.set(key, [(rand() - 0.5) * 0.9, (rand() - 0.5) * 0.6, (rand() - 0.5) * 0.9]);
    const [dx, dy, dz] = jitter.get(key)!;
    const top = pos.getY(i) > 2.9; // l'anneau du haut reste plat pour épouser la dalle
    pos.setXYZ(i, pos.getX(i) + dx, pos.getY(i) + (top ? 0 : dy), pos.getZ(i) + dz);
  }
  rockGeo.computeVertexNormals();
  const rock = new THREE.Mesh(
    rockGeo,
    new THREE.MeshStandardMaterial({ color: skin.rock, flatShading: true, roughness: 1 }),
  );
  rock.position.y = -0.5 - 3;
  g.add(rock);

  // Quelques rochers satellites
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.6;
    const s = 0.5 + rand() * 0.5;
    const r = new THREE.Mesh(
      new THREE.DodecahedronGeometry(s, 0),
      new THREE.MeshStandardMaterial({ color: skin.rock, flatShading: true, roughness: 1 }),
    );
    r.position.set(Math.cos(a) * (half + 2.5), -2 - rand() * 2, Math.sin(a) * (half + 2.5));
    r.userData.bob = rand() * Math.PI * 2;
    g.add(r);
  }
  return g;
}

export interface Clouds {
  group: THREE.Group;
  update(dt: number): void;
}

/** Nuages : grappes d'icosaèdres blancs qui dérivent lentement et reviennent de l'autre côté. */
export function buildClouds(count = 7, spread = 22): Clouds & { setColor(c: string): void } {
  const rand = mulberry32(11);
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    flatShading: true,
    roughness: 1,
    transparent: true,
    opacity: 0.92,
    emissive: '#ffffff',
    emissiveIntensity: 0.25,
  });
  const items: { obj: THREE.Group; speed: number }[] = [];
  for (let k = 0; k < count; k++) {
    const cloud = new THREE.Group();
    const puffs = 3 + Math.floor(rand() * 3);
    for (let p = 0; p < puffs; p++) {
      const s = 0.6 + rand() * 0.8;
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), mat);
      puff.position.set(p * 0.9 - puffs * 0.45, rand() * 0.3, (rand() - 0.5) * 0.8);
      puff.scale.y = 0.7;
      cloud.add(puff);
    }
    cloud.position.set((rand() - 0.5) * spread * 2, -4 + rand() * 7, (rand() - 0.5) * spread * 2);
    // Pas de nuage au-dessus du plateau : il masquerait le jeu.
    if (Math.abs(cloud.position.x) < 9 && Math.abs(cloud.position.z) < 9) cloud.position.z += cloud.position.z < 0 ? -10 : 10;
    group.add(cloud);
    items.push({ obj: cloud, speed: 0.25 + rand() * 0.35 });
  }
  return {
    group,
    setColor(c) {
      mat.color.set(c);
      mat.emissive.set(c);
    },
    update(dt) {
      for (const it of items) {
        it.obj.position.x += it.speed * dt;
        if (it.obj.position.x > spread) it.obj.position.x = -spread;
      }
    },
  };
}
