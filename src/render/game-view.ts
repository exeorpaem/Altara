// Vue de partie : pièces, sélection, marqueurs de coups, aperçu de chemin, animations.
// Ne dépend que de l'interface GameEngine (jamais de movement.ts directement).
import * as THREE from 'three';
import { PIECES, type PieceType, type PlayerId } from '../engine/rules';
import type { BlockedAttack, GameEngine, Move, Piece } from '../engine/types';
import { CELL, type BoardView } from './board';
import { buildPieceMesh } from './pieces';
import type { PieceBuilder } from './pieces-styles/common';
import { PALETTE } from './palette';

const STEP_MS = 150; // durée d'un pas
const LIFT = 0.32; // élévation de la pièce sélectionnée
const MARK_Y = 0.03; // surélévation des marqueurs (évite le z-fighting)
const ATTACK_RED = '#E5484D';
const BLOCKED_GREY = '#8E8E9A';

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const key = (r: number, c: number) => r * 100 + c;

interface PieceView {
  holder: THREE.Group; // positionné sur la case
  model: THREE.Group; // modèle (s'élève, flotte)
  materials: { mat: THREE.MeshStandardMaterial; base: THREE.Color }[];
}

interface Tween {
  elapsed: number;
  duration: number;
  step: (t: number) => void;
  resolve: () => void;
}

/**
 * Événements sonores émis par la vue (le son est géré ailleurs, dans ui/sound.ts :
 * la vue ne fait que signaler ce qui se passe à l'écran, au bon moment de l'animation).
 */
export type ViewSfx =
  | { type: 'select'; piece: PieceType; player: PlayerId }
  | { type: 'deselect'; player: PlayerId }
  | { type: 'hover'; kind: Move['kind']; cost: number; max: number }
  | { type: 'step'; height: number; dh: number; index: number }
  | { type: 'lift'; dh: number }
  | { type: 'diagonal' }
  | { type: 'leap' }
  | { type: 'land'; height: number }
  | { type: 'attack' }
  | { type: 'shatter'; piece: PieceType; player: PlayerId }
  | { type: 'exit'; player: PlayerId; piece: PieceType };

export interface GameViewOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  dom: HTMLCanvasElement;
  overlay: HTMLElement; // calque HTML pour les étiquettes
  engine: GameEngine;
  board: BoardView;
  /** Appelé après chaque coup joué (mise à jour de l'interface). */
  onChange?: () => void;
  /** Élément d'interface vers lequel une pièce sortie « s'envole » (score du camp). */
  scoreTarget?: (player: PlayerId) => HTMLElement | null;
  /** Retour sonore (facultatif). */
  onSfx?: (e: ViewSfx) => void;
  /**
   * Pendule (facultatif) : appelé dès que le coup est choisi, avant l'animation ;
   * renvoie le temps de réflexion à décompter (l'animation n'est pas comptée).
   */
  takeElapsed?: () => number;
  /** Constructeur des pièces (style alternatif via ?pieces=<id>) ; défaut : buildPieceMesh. */
  buildPiece?: PieceBuilder;
}

export class GameView {
  private o: GameViewOptions;
  private root = new THREE.Group();
  private pieces = new Map<string, PieceView>();
  private markers = new THREE.Group();
  private preview = new THREE.Group();
  private lastMove = new THREE.Group();
  private fx = new THREE.Group();
  private tweens: Tween[] = [];
  private shards: { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; life: number }[] = [];
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private time = 0;

  private selected: string | null = null;
  private moves: Move[] = [];
  /** Destinations indexées : case → coup (déplacement ou spécial), cible → attaque. */
  private destByCell = new Map<number, Move>();
  private attackByTarget = new Map<string, Move>();
  /** Attaques refusées (anneau gris pointillé), par pièce ciblée. */
  private blockedByTarget = new Map<string, BlockedAttack>();
  private hoveredBlocked: BlockedAttack | null = null;
  private hovered: Move | null = null;
  private selRing: THREE.Mesh;

  private label: HTMLDivElement;
  private tooltip: HTMLDivElement;
  private attackPanel: HTMLDivElement;
  /** Animation en cours : aucune interaction. */
  busy = false;
  /**
   * Jeu verrouillé de l'extérieur (l'IA réfléchit…) : on ne peut plus jouer,
   * mais on peut encore inspecter les pièces.
   */
  locked = false;
  /** La sélection courante est une inspection (pièce non jouable) : marqueurs creux, rien n'est jouable. */
  private inspecting = false;
  private banner: HTMLDivElement;

  constructor(o: GameViewOptions) {
    this.o = o;
    this.root.name = 'game';
    this.root.add(this.lastMove, this.markers, this.preview, this.fx);
    o.scene.add(this.root);

    this.selRing = new THREE.Mesh(
      new THREE.RingGeometry(0.38, 0.47, 40),
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    );
    this.selRing.rotation.x = -Math.PI / 2;
    this.selRing.renderOrder = 3;
    this.selRing.visible = false;
    this.root.add(this.selRing);

    this.label = this.div('gv-label');
    this.tooltip = this.div('gv-tooltip');
    this.attackPanel = this.div('gv-attack');
    this.banner = this.div('gv-inspect');

    this.bindInput();
    this.sync();
  }

  // ---------------------------------------------------------------------------
  // Synchronisation avec l'état du moteur
  // ---------------------------------------------------------------------------

  /** Remplace le plateau (changement de skin) en gardant la partie. */
  setBoard(board: BoardView) {
    this.o.board = board;
    this.sync();
  }

  /** Place toutes les pièces selon l'état courant, sans animation. */
  sync() {
    const state = this.o.engine.getState();
    for (const p of state.pieces) {
      let view = this.pieces.get(p.id);
      if (!view) {
        view = this.makePieceView(p);
        this.pieces.set(p.id, view);
        this.root.add(view.holder);
      }
      view.holder.visible = p.status === 'board';
      view.model.position.set(0, 0, 0);
      view.model.scale.setScalar(1);
      this.setOpacity(view, 1);
      if (p.status === 'board') view.holder.position.copy(this.o.board.cellTop(p.row, p.col));
    }
    this.deselect();
    this.refreshDesaturation();
    this.showLastMove();
  }

  private makePieceView(p: Piece): PieceView {
    const holder = new THREE.Group();
    const model = (this.o.buildPiece ?? buildPieceMesh)({ type: p.type, player: p.player });
    // L'avant du modèle est +Z local ; J1 sort vers −Z (rangée 9), J2 vers +Z.
    model.rotation.y = p.player === 1 ? Math.PI : 0;
    holder.add(model);
    holder.userData.pieceId = p.id;
    const materials: PieceView['materials'] = [];
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.userData.pieceId = p.id;
      // Matériaux propres à chaque pièce : on peut la désaturer ou l'effacer seule.
      const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
      mesh.material = mat;
      materials.push({ mat, base: mat.color.clone() });
    });
    return { holder, model, materials };
  }

  private setOpacity(v: PieceView, a: number) {
    for (const { mat } of v.materials) {
      mat.transparent = a < 1;
      mat.opacity = a;
      mat.depthWrite = a >= 1;
    }
  }

  /** Mes pièces sans coup possible sont légèrement désaturées pendant mon tour. */
  private refreshDesaturation() {
    const state = this.o.engine.getState();
    const grey = new THREE.Color('#bdbdc4');
    for (const p of state.pieces) {
      const v = this.pieces.get(p.id)!;
      const stuck = p.status === 'board' && p.player === state.current && this.o.engine.getLegalMoves(p.id).length === 0;
      for (const { mat, base } of v.materials) mat.color.copy(base).lerp(grey, stuck ? 0.55 : 0);
    }
  }

  /** Dernier coup : cases de départ et d'arrivée teintées discrètement. */
  private showLastMove() {
    clear(this.lastMove);
    // Dernier vrai coup (les passes n'ont pas de cases à marquer).
    const rec = [...this.o.engine.getState().history].reverse().find((h) => h.move);
    const move = rec?.move;
    if (!rec || !move) return;
    const cells = [move.path[0]];
    if (move.kind !== 'exit') cells.push(move.path[move.path.length - 1]);
    for (const c of cells) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(CELL * 0.86, CELL * 0.86),
        new THREE.MeshBasicMaterial({ color: PALETTE.camp[rec.player], transparent: true, opacity: 0.28, depthWrite: false }),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.copy(this.o.board.cellTop(c.row, c.col)).add(new THREE.Vector3(0, 0.012, 0));
      m.renderOrder = 1;
      this.lastMove.add(m);
    }
  }

  // ---------------------------------------------------------------------------
  // Sélection et marqueurs
  // ---------------------------------------------------------------------------

  /** Sélectionne une de mes pièces jouables : ses coups sont affichés et jouables. */
  select(pieceId: string) {
    const state = this.o.engine.getState();
    const p = state.pieces.find((x) => x.id === pieceId);
    if (!p || p.player !== state.current || p.status !== 'board' || this.locked) return;
    this.show(pieceId, this.o.engine.getLegalMoves(pieceId), false);
  }

  /**
   * Inspecte une pièce qu'on ne peut pas jouer maintenant (pièce adverse, ou tour de l'IA) :
   * on affiche les coups qu'elle aurait si c'était à son camp de jouer, sans pouvoir les jouer.
   */
  inspect(pieceId: string) {
    const p = this.o.engine.getState().pieces.find((x) => x.id === pieceId);
    if (!p || p.status !== 'board') return;
    this.show(pieceId, this.o.engine.getPotentialMoves?.(pieceId) ?? [], true);
  }

  private show(pieceId: string, moves: Move[], inspecting: boolean) {
    const state = this.o.engine.getState();
    const p = state.pieces.find((x) => x.id === pieceId)!;
    this.deselect();
    this.selected = pieceId;
    this.inspecting = inspecting;
    this.moves = moves;
    this.o.onSfx?.({ type: 'select', piece: p.type, player: p.player });
    this.o.dom.dispatchEvent(new CustomEvent('altara:select'));

    const def = PIECES[p.type];
    const camp = PALETTE.camp[p.player];
    const ringMat = this.selRing.material as THREE.MeshBasicMaterial;
    ringMat.color.set(camp).lerp(new THREE.Color('#ffffff'), 0.35);
    ringMat.opacity = inspecting ? 0.5 : 0.8;
    if (inspecting) {
      const names: Record<PlayerId, string> = { 1: 'Corail', 2: 'Lagon' };
      this.banner.innerHTML = `<i style="background:${camp}"></i><span><b>${def.name} ${names[p.player]}</b> — ${
        moves.length ? `ses coups s'il jouait maintenant` : `aucun coup possible pour l'instant`
      }</span><small>Échap ou clic ailleurs pour fermer</small>`;
      this.banner.style.display = 'flex';
    }
    this.selRing.position.copy(this.o.board.cellTop(p.row, p.col)).add(new THREE.Vector3(0, MARK_Y, 0));
    this.selRing.visible = true;

    for (const m of this.moves) {
      const to = m.path[m.path.length - 1];
      if (m.kind === 'attack') this.attackByTarget.set(m.targetId!, m);
      else if (m.kind === 'exit') continue;
      else {
        // Même case atteignable normalement et par un coup spécial : on garde le déplacement normal.
        const k = key(to.row, to.col);
        const prev = this.destByCell.get(k);
        if (!prev || (prev.kind !== 'move' && m.kind === 'move')) this.destByCell.set(k, m);
      }
    }

    // Déplacements et coups spéciaux
    for (const m of this.destByCell.values()) {
      const to = m.path[m.path.length - 1];
      const pos = this.o.board.cellTop(to.row, to.col).add(new THREE.Vector3(0, MARK_Y, 0));
      if (m.kind === 'move') {
        // Opacité décroissante avec le coût : 1 point → très visible, M points → discret.
        const t = def.movement > 1 ? (m.cost - 1) / (def.movement - 1) : 0;
        // Inspection : anneau creux au lieu d'une pastille pleine (« possible, mais pas jouable »).
        const dot = inspecting
          ? flatMesh(new THREE.RingGeometry(0.12, 0.2, 28), camp, 0.95 - 0.55 * t)
          : flatMesh(new THREE.CircleGeometry(0.2, 28), camp, 0.95 - 0.6 * t);
        dot.position.copy(pos);
        dot.userData.move = m;
        this.markers.add(dot);
      } else {
        const outer = flatMesh(new THREE.CircleGeometry(0.27, 4), camp, 0.95);
        const inner = flatMesh(new THREE.CircleGeometry(inspecting ? 0.19 : 0.13, 4), '#ffffff', 0.95);
        outer.userData.move = inner.userData.move = m;
        outer.position.copy(pos);
        inner.position.copy(pos).add(new THREE.Vector3(0, 0.003, 0));
        this.markers.add(outer, inner);
      }
    }

    // Attaques : anneau rouge autour de la cible
    for (const m of this.attackByTarget.values()) {
      const to = m.path[m.path.length - 1];
      const ring = flatMesh(new THREE.RingGeometry(0.36, 0.45, 40), ATTACK_RED, 0.9);
      ring.position.copy(this.o.board.cellTop(to.row, to.col)).add(new THREE.Vector3(0, MARK_Y, 0));
      ring.userData.pulse = true;
      ring.userData.move = m;
      this.markers.add(ring);
    }

    // Attaques refusées : anneau gris pointillé autour de la cible (survol = explication).
    for (const b of this.o.engine.getBlockedAttacks?.(pieceId) ?? []) {
      this.blockedByTarget.set(b.targetId, b);
      const to = b.path[b.path.length - 1];
      const ring = dashedRing(0.36, 0.44, 12, BLOCKED_GREY, 0.85);
      ring.position.copy(this.o.board.cellTop(to.row, to.col)).add(new THREE.Vector3(0, MARK_Y, 0));
      ring.traverse((o) => (o.userData.blocked = b)); // chaque arc du pointillé est cliquable
      this.markers.add(ring);
    }

    // Sorties : flèche au-delà du bord, devant la colonne d'où l'on sort
    const dirZ = p.player === 1 ? -1 : 1;
    for (const m of this.moves.filter((x) => x.kind === 'exit')) {
      const from = m.path[m.path.length - 1];
      const arrow = flatMesh(arrowGeometry(), camp, inspecting ? 0.55 : 0.95);
      arrow.position.copy(this.o.board.cellTop(from.row, from.col)).add(new THREE.Vector3(0, MARK_Y, dirZ * 0.95 * CELL));
      arrow.rotation.z = dirZ < 0 ? 0 : Math.PI; // la flèche (dessinée vers −Z) pointe vers l'extérieur
      arrow.userData.move = m;
      this.markers.add(arrow);
    }
  }

  deselect() {
    this.selected = null;
    this.inspecting = false;
    this.banner.style.display = 'none';
    this.moves = [];
    this.destByCell.clear();
    this.attackByTarget.clear();
    this.blockedByTarget.clear();
    this.selRing.visible = false;
    clear(this.markers);
    this.clearPreview();
    for (const v of this.pieces.values()) v.model.position.y = 0;
  }

  // ---------------------------------------------------------------------------
  // Aperçu d'un coup (survol)
  // ---------------------------------------------------------------------------

  private clearPreview() {
    this.hovered = null;
    this.hoveredBlocked = null;
    this.attackPanel.classList.remove('blocked');
    clear(this.preview);
    this.label.style.display = 'none';
    this.attackPanel.style.display = 'none';
  }

  private showPreview(move: Move) {
    if (this.hovered === move) return;
    this.clearPreview();
    this.hovered = move;
    const state = this.o.engine.getState();
    const piece = state.pieces.find((p) => p.id === move.pieceId)!;
    const def = PIECES[piece.type];
    this.o.onSfx?.({ type: 'hover', kind: move.kind, cost: move.cost, max: def.movement });
    const camp = PALETTE.camp[piece.player];

    // Pointillés le long du chemin (arc pour un coup spécial)
    const pts = this.pathPoints(move, piece.player);
    const dots = sampleDots(pts, 0.15);
    const dotGeo = new THREE.SphereGeometry(0.05, 8, 6);
    const dotMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(camp).multiplyScalar(0.72), fog: false });
    const inst = new THREE.InstancedMesh(dotGeo, dotMat, dots.length);
    dots.forEach((d, i) => inst.setMatrixAt(i, new THREE.Matrix4().makeTranslation(d.x, d.y, d.z)));
    inst.renderOrder = 4;
    this.preview.add(inst);

    // Silhouette fantôme à l'arrivée (case d'appui pour une attaque, aucune pour une sortie)
    const ghostCell = move.kind === 'attack' ? move.path[move.path.length - 2] : move.path[move.path.length - 1];
    if (move.kind !== 'exit' && ghostCell) {
      const ghost = (this.o.buildPiece ?? buildPieceMesh)({ type: piece.type, player: piece.player });
      ghost.rotation.y = piece.player === 1 ? Math.PI : 0;
      ghost.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
        Object.assign(mat, { transparent: true, opacity: 0.38, depthWrite: false });
        mesh.material = mat;
        mesh.castShadow = false;
      });
      ghost.position.copy(this.o.board.cellTop(ghostCell.row, ghostCell.col));
      this.preview.add(ghost);
    }

    // Étiquette « coût / Mouvement »
    const end = pts[pts.length - 1];
    const prefix =
      (this.inspecting ? 'Possible · ' : '') + (move.kind === 'exit' ? 'Sortie · ' : move.kind === 'attack' ? 'Attaque · ' : '');
    this.label.innerHTML = `${prefix}<b>${move.cost}</b> / ${def.movement}`;
    this.label.style.display = 'block';
    this.label.dataset.x = String(end.x);
    this.label.dataset.y = String(end.y + 0.55);
    this.label.dataset.z = String(end.z);

    // Panneau d'aperçu d'attaque (rempli par previewAttack, stub en session 1)
    if (move.kind === 'attack') {
      const pv = this.o.engine.previewAttack?.(move);
      const target = state.pieces.find((p) => p.id === move.targetId)!;
      this.attackPanel.innerHTML = `
        <div class="gv-attack-title">${this.inspecting ? 'Menace : combat possible' : 'Aperçu du combat'}</div>
        <div class="gv-attack-row">
          <span><i style="background:${camp}"></i>${def.name}</span><b>${pv?.attack ?? '–'}</b>
        </div>
        <div class="gv-attack-row">
          <span><i style="background:${PALETTE.camp[target.player]}"></i>${PIECES[target.type].name}</span><b>${pv?.defense ?? '–'}</b>
        </div>
        <ul>${(pv?.details ?? []).map((d) => `<li>${d}</li>`).join('')}</ul>`;
      this.attackPanel.style.display = 'block';
    }
  }

  /**
   * Explique une attaque refusée : chemin en pointillés gris jusqu'à la cible,
   * étiquette courte et panneau détaillé (forces et modificateurs, ou coût manquant).
   */
  private showBlocked(b: BlockedAttack) {
    if (this.hoveredBlocked === b) return;
    this.clearPreview();
    this.hoveredBlocked = b;
    const state = this.o.engine.getState();
    const piece = state.pieces.find((p) => p.id === b.pieceId)!;
    const target = state.pieces.find((p) => p.id === b.targetId)!;
    const def = PIECES[piece.type];

    const pts = this.pathPoints({ pieceId: b.pieceId, path: b.path, cost: b.cost, kind: 'move' }, piece.player);
    const dots = sampleDots(pts, 0.15);
    const inst = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.045, 8, 6),
      new THREE.MeshBasicMaterial({ color: BLOCKED_GREY, fog: false }),
      dots.length,
    );
    dots.forEach((d, i) => inst.setMatrixAt(i, new THREE.Matrix4().makeTranslation(d.x, d.y, d.z)));
    inst.renderOrder = 4;
    this.preview.add(inst);

    const end = pts[pts.length - 1];
    this.label.innerHTML =
      b.reason === 'weak'
        ? `Trop faible · <b>${b.attack}</b> contre ${b.defense}`
        : `Hors de portée · coût <b>${b.cost}</b> / ${def.movement}`;
    this.label.style.display = 'block';
    this.label.dataset.x = String(end.x);
    this.label.dataset.y = String(end.y + 0.55);
    this.label.dataset.z = String(end.z);

    const camp = PALETTE.camp[piece.player];
    const foe = PALETTE.camp[target.player];
    const tName = PIECES[target.type].name;
    this.attackPanel.classList.add('blocked');
    this.attackPanel.innerHTML =
      b.reason === 'weak'
        ? `<div class="gv-attack-title">Attaque impossible : trop faible</div>
           <div class="gv-attack-row"><span><i style="background:${camp}"></i>${def.name}</span><b>${b.attack}</b></div>
           <div class="gv-attack-row"><span><i style="background:${foe}"></i>${tName}</span><b>${b.defense}</b></div>
           <ul>${b.details.map((d) => `<li>${d}</li>`).join('')}</ul>
           <p class="gv-why">Il faut une attaque au moins égale à la défense.</p>`
        : `<div class="gv-attack-title">Attaque impossible : hors de portée</div>
           <p class="gv-why">Atteindre ${tName === 'Avant-garde' ? "l'Avant-garde" : tName === 'Explorateur' ? "l'Explorateur" : 'la Sentinelle'} coûterait
           <b>${b.cost}</b> points de Mouvement, entrée sur sa case comprise (chaque marche coûte son dénivelé + 1).
           ${def.name === 'Explorateur' ? "L'Explorateur" : def.name === 'Avant-garde' ? "L'Avant-garde" : 'La Sentinelle'} n'en a que <b>${def.movement}</b>.</p>`;
    this.attackPanel.style.display = 'block';
  }

  /** Points 3D du tracé : suit le relief case par case, ou dessine un arc pour un coup spécial. */
  private pathPoints(move: Move, player: PlayerId): THREE.Vector3[] {
    const b = this.o.board;
    const top = (c: { row: number; col: number }) => b.cellTop(c.row, c.col).add(new THREE.Vector3(0, 0.07, 0));
    if (move.kind === 'explorerDiagonal' || move.kind === 'explorerLeap') {
      const a = top(move.path[0]);
      const z = top(move.path[1]);
      const apex = Math.max(a.y, z.y) + (move.kind === 'explorerLeap' ? 1.2 : 0.45);
      const mid = a.clone().lerp(z, 0.5);
      mid.y = apex;
      return new THREE.QuadraticBezierCurve3(a, mid, z).getPoints(28);
    }
    const pts: THREE.Vector3[] = [top(move.path[0])];
    for (let i = 1; i < move.path.length; i++) {
      const a = top(move.path[i - 1]);
      const z = top(move.path[i]);
      if (Math.abs(a.y - z.y) > 1e-6) {
        // Marche : on avance jusqu'au bord, on monte/descend, puis on repart.
        const edge = a.clone().lerp(z, 0.5);
        pts.push(new THREE.Vector3(edge.x, a.y, edge.z), new THREE.Vector3(edge.x, z.y, edge.z));
      }
      pts.push(z);
    }
    if (move.kind === 'exit') {
      const last = pts[pts.length - 1];
      pts.push(last.clone().add(new THREE.Vector3(0, 0, (player === 1 ? -1 : 1) * 0.8)));
    }
    return pts;
  }

  // ---------------------------------------------------------------------------
  // Entrées (souris et tactile)
  // ---------------------------------------------------------------------------

  private bindInput() {
    const dom = this.o.dom;
    let down: { x: number; y: number; t: number } | null = null;
    dom.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY, t: performance.now() }));
    dom.addEventListener('pointerup', (e) => {
      // Un glisser fait tourner la caméra : seul un clic court et immobile compte.
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || performance.now() - down.t > 600) return;
      // Clic droit : annule la sélection (ou l'inspection) en cours, ne joue jamais de coup.
      if (e.button === 2) {
        if (!this.busy) this.userDeselect();
        return;
      }
      if (e.button !== 0) return; // clic molette : ignoré
      this.onClick(e);
    });
    // Pas de menu contextuel du navigateur sur le plateau : le clic droit sert à annuler.
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') this.onHover(e);
    });
    dom.addEventListener('pointerleave', () => (this.tooltip.style.display = 'none'));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.busy) this.userDeselect();
    });
  }

  private pick(e: PointerEvent): { move?: Move; pieceId?: string; blocked?: BlockedAttack } {
    const rect = this.o.dom.getBoundingClientRect();
    this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.o.camera);
    const targets: THREE.Object3D[] = [this.o.board.pickMesh, this.markers];
    for (const v of this.pieces.values()) if (v.holder.visible) targets.push(v.holder);
    // On parcourt les impacts du plus proche au plus lointain jusqu'au premier qui a un sens
    // (un marqueur décoratif ou une ombre ne doit pas « avaler » le clic).
    for (const hit of this.raycaster.intersectObjects(targets, true)) {
      const obj = hit.object;
      if (obj.userData.move) return { move: obj.userData.move };
      if (obj.userData.blocked) return { blocked: obj.userData.blocked, pieceId: obj.userData.blocked.targetId };
      if (obj.userData.pieceId) {
        const id = obj.userData.pieceId as string;
        const att = this.attackByTarget.get(id);
        return att ? { move: att, pieceId: id } : { pieceId: id, blocked: this.blockedByTarget.get(id) };
      }
      if (obj === this.o.board.pickMesh && hit.instanceId !== undefined) {
        const c = this.o.board.cellOfInstance(hit.instanceId);
        const m = this.destByCell.get(key(c.row, c.col));
        if (m) return { move: m };
        // Case occupée : on renvoie l'occupant (cible d'attaque ou simple infobulle)
        const occupant = this.o.engine
          .getState()
          .pieces.find((p) => p.status === 'board' && p.row === c.row && p.col === c.col);
        if (!occupant) return {};
        const att = this.attackByTarget.get(occupant.id);
        return att
          ? { move: att, pieceId: occupant.id }
          : { pieceId: occupant.id, blocked: this.blockedByTarget.get(occupant.id) };
      }
    }
    return {};
  }

  private onClick(e: PointerEvent) {
    if (this.busy) return;
    const { move, pieceId, blocked } = this.pick(e);
    if (blocked && this.selected) {
      this.showBlocked(blocked);
      return;
    }
    if (move && this.selected && !this.inspecting && !this.locked) {
      // Au tactile (pas de survol), un premier appui montre l'aperçu, le second joue.
      if (e.pointerType !== 'mouse' && this.hovered !== move) return this.showPreview(move);
      return void this.playMove(move);
    }
    // En inspection, toucher une destination montre son chemin (rien n'est jouable).
    if (move && this.inspecting && !pieceId) {
      if (e.pointerType !== 'mouse') this.showPreview(move);
      return;
    }
    const state = this.o.engine.getState();
    const p = pieceId ? state.pieces.find((x) => x.id === pieceId) : undefined;
    if (p) {
      if (this.selected === p.id) this.userDeselect();
      else if (p.player === state.current && !this.locked) this.select(p.id);
      else this.inspect(p.id); // pièce adverse (ou tour de l'IA) : on regarde ses possibilités
      return;
    }
    this.userDeselect();
  }

  /** Désélection voulue par le joueur (clic ailleurs, Échap) : seule celle-ci fait du bruit. */
  private userDeselect() {
    if (this.selected) this.o.onSfx?.({ type: 'deselect', player: this.o.engine.getState().current });
    this.deselect();
  }

  private onHover(e: PointerEvent) {
    if (this.busy) return;
    const { move, pieceId, blocked } = this.pick(e);
    if (move && this.selected) this.showPreview(move);
    else if (blocked && this.selected) this.showBlocked(blocked);
    else if (this.hovered || this.hoveredBlocked) this.clearPreview();
    this.o.dom.style.cursor = move || pieceId ? 'pointer' : '';

    // Infobulle de pièce (sauf quand on survole une cible d'attaque : le panneau d'aperçu suffit)
    const p = pieceId && !move && !(blocked && this.selected) ? this.o.engine.getState().pieces.find((x) => x.id === pieceId) : undefined;
    if (p) {
      const def = PIECES[p.type];
      this.tooltip.innerHTML = `<b><i style="background:${PALETTE.camp[p.player]}"></i>${def.name}</b>
        <span>Mouvement ${def.movement} · Force ${def.strength}</span><small>${def.ability}</small>`;
      this.tooltip.style.display = 'block';
      this.tooltip.style.left = `${e.clientX + 14}px`;
      this.tooltip.style.top = `${e.clientY + 14}px`;
    } else this.tooltip.style.display = 'none';
  }

  // ---------------------------------------------------------------------------
  // Jouer un coup + animations
  // ---------------------------------------------------------------------------

  async playMove(move: Move) {
    if (this.busy) return;
    this.busy = true;
    const elapsed = this.o.takeElapsed?.() ?? 0;
    this.tooltip.style.display = 'none';
    const state = this.o.engine.getState();
    const piece = { ...state.pieces.find((p) => p.id === move.pieceId)! };
    const view = this.pieces.get(move.pieceId)!;
    const lifted = view.model.position.y;
    this.deselect();
    view.model.position.y = lifted;

    // L'animation se fait sur une copie des positions ; le moteur n'est appelé qu'à la fin.
    const b = this.o.board;
    const at = (c: { row: number; col: number }) => b.cellTop(c.row, c.col);
    await this.tween(120, (t) => (view.model.position.y = lifted * (1 - t)));

    if (move.kind === 'explorerDiagonal' || move.kind === 'explorerLeap') {
      const leap = move.kind === 'explorerLeap';
      this.o.onSfx?.({ type: leap ? 'leap' : 'diagonal' });
      await this.hop(view, at(move.path[0]), at(move.path[1]), leap ? 1.3 : 0.5, leap ? 480 : 300);
      this.o.onSfx?.({ type: 'land', height: this.heightOf(move.path[1]) });
    } else {
      const walk = move.kind === 'attack' ? move.path.slice(0, -1) : move.path;
      for (let i = 1; i < walk.length; i++) {
        const a = at(walk[i - 1]);
        const z = at(walk[i]);
        const dh = Math.abs(a.y - z.y);
        const dLevels = this.heightOf(walk[i]) - this.heightOf(walk[i - 1]);
        if (dLevels !== 0) this.o.onSfx?.({ type: 'lift', dh: dLevels });
        // Petit saut à chaque changement de hauteur, simple glissé sinon.
        await this.hop(view, a, z, dh > 0 ? 0.18 + dh * 0.5 : 0.03, STEP_MS + dh * 120);
        this.o.onSfx?.({ type: 'step', height: this.heightOf(walk[i]), dh: dLevels, index: i });
      }
      if (move.kind === 'attack') {
        const from = at(walk[walk.length - 1]);
        const target = this.pieces.get(move.targetId!)!;
        const to = at(move.path[move.path.length - 1]);
        // Élan : la pièce recule légèrement puis frappe ; la cible vole en éclats à l'impact.
        await this.hop(view, from, from.clone().lerp(to, -0.12), 0.05, 110);
        this.o.onSfx?.({ type: 'attack' });
        let shattered = false;
        const victim = state.pieces.find((p) => p.id === move.targetId)!;
        await this.hop(view, from.clone().lerp(to, -0.12), to, 0.25, 220, (t) => {
          if (!shattered && t > 0.5) {
            shattered = true;
            this.shatter(target);
            this.o.onSfx?.({ type: 'shatter', piece: victim.type, player: victim.player });
          }
        });
      }
      if (move.kind === 'exit') {
        const from = view.holder.position.clone();
        const out = from.clone().add(new THREE.Vector3(0, 0.15, (piece.player === 1 ? -1 : 1) * 1.1));
        this.flyToScore(view, piece.player);
        this.o.onSfx?.({ type: 'exit', player: piece.player, piece: piece.type });
        await this.tween(450, (t) => {
          view.holder.position.lerpVectors(from, out, easeInOut(t));
          view.model.scale.setScalar(1 - 0.6 * t);
          this.setOpacity(view, 1 - t);
        });
      }
    }

    this.o.engine.play(move, elapsed);
    this.busy = false;
    this.sync();
    this.o.onChange?.();
  }

  private heightOf(c: { row: number; col: number }) {
    return this.o.engine.getState().terrain.heights[c.row][c.col];
  }

  /** Déplacement d'un point à un autre avec une parabole de hauteur `height`. */
  private hop(v: PieceView, a: THREE.Vector3, z: THREE.Vector3, height: number, ms: number, onT?: (t: number) => void) {
    return this.tween(ms, (t) => {
      const k = easeInOut(t);
      v.holder.position.lerpVectors(a, z, k);
      v.holder.position.y += Math.sin(Math.PI * k) * height;
      onT?.(t);
    });
  }

  private tween(ms: number, step: (t: number) => void): Promise<void> {
    return new Promise((resolve) => this.tweens.push({ elapsed: 0, duration: ms / 1000, step, resolve }));
  }

  /** Capture : la pièce se fragmente en éclats low-poly qui tombent sous le plateau. */
  private shatter(v: PieceView) {
    const origin = v.holder.position.clone();
    v.holder.visible = false;
    const color = v.materials[0]?.base ?? new THREE.Color('#ccc');
    const mat = new THREE.MeshStandardMaterial({ color, flatShading: true, transparent: true });
    for (let i = 0; i < 18; i++) {
      const mesh = new THREE.Mesh(new THREE.TetrahedronGeometry(0.05 + Math.random() * 0.07), mat);
      mesh.position.copy(origin).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, Math.random() * 1.1, (Math.random() - 0.5) * 0.4));
      const vel = new THREE.Vector3((Math.random() - 0.5) * 3, 1.5 + Math.random() * 2.5, (Math.random() - 0.5) * 3);
      const spin = new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8);
      this.fx.add(mesh);
      this.shards.push({ mesh, vel, spin, life: 0 });
    }
  }

  /** Sortie : une pastille du camp s'envole de la pièce vers le score de son camp. */
  private flyToScore(v: PieceView, player: PlayerId) {
    const target = this.o.scoreTarget?.(player);
    if (!target) return;
    const p = v.holder.position.clone().add(new THREE.Vector3(0, 0.7, 0)).project(this.o.camera);
    const rect = this.o.dom.getBoundingClientRect();
    const dot = document.createElement('div');
    dot.className = 'gv-fly';
    dot.style.background = PALETTE.camp[player];
    dot.style.left = `${rect.left + ((p.x + 1) / 2) * rect.width}px`;
    dot.style.top = `${rect.top + ((1 - p.y) / 2) * rect.height}px`;
    document.body.appendChild(dot);
    const tr = target.getBoundingClientRect();
    requestAnimationFrame(() => {
      dot.style.left = `${tr.left + tr.width / 2}px`;
      dot.style.top = `${tr.top + tr.height / 2}px`;
      dot.style.transform = 'translate(-50%, -50%) scale(0.4)';
      dot.style.opacity = '0.2';
    });
    setTimeout(() => {
      dot.remove();
      target.classList.add('pulse');
      setTimeout(() => target.classList.remove('pulse'), 500);
    }, 750);
  }

  // ---------------------------------------------------------------------------
  // Boucle
  // ---------------------------------------------------------------------------

  update(dt: number) {
    this.time += dt;

    for (const tw of [...this.tweens]) {
      tw.elapsed += dt;
      const t = Math.min(1, tw.elapsed / tw.duration);
      tw.step(t);
      if (t >= 1) {
        this.tweens.splice(this.tweens.indexOf(tw), 1);
        tw.resolve();
      }
    }

    // Pièce sélectionnée : s'élève et flotte ; anneau lumineux qui respire.
    if (this.selected && !this.busy && !this.inspecting) {
      const v = this.pieces.get(this.selected)!;
      const target = LIFT + Math.sin(this.time * 2.6) * 0.04;
      v.model.position.y += (target - v.model.position.y) * Math.min(1, dt * 10);
      (this.selRing.material as THREE.MeshBasicMaterial).opacity = 0.65 + Math.sin(this.time * 3) * 0.2;
    }
    for (const m of this.markers.children) {
      if (m.userData.pulse) m.scale.setScalar(1 + Math.sin(this.time * 4) * 0.06);
    }

    // Éclats : chute libre avec rotation, fondu puis suppression.
    for (const s of [...this.shards]) {
      s.life += dt;
      s.vel.y -= 9.8 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      (s.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, 1 - Math.max(0, s.life - 0.9) / 0.8);
      if (s.life > 1.8) {
        this.fx.remove(s.mesh);
        s.mesh.geometry.dispose();
        this.shards.splice(this.shards.indexOf(s), 1);
      }
    }

    // Étiquette de coût projetée à l'écran
    if (this.label.style.display === 'block') {
      const p = new THREE.Vector3(+this.label.dataset.x!, +this.label.dataset.y!, +this.label.dataset.z!).project(this.o.camera);
      const rect = this.o.dom.getBoundingClientRect();
      this.label.style.left = `${((p.x + 1) / 2) * rect.width}px`;
      this.label.style.top = `${((1 - p.y) / 2) * rect.height}px`;
    }
  }

  dispose() {
    this.o.scene.remove(this.root);
    this.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.label.remove();
    this.tooltip.remove();
    this.attackPanel.remove();
    this.banner.remove();
  }

  private div(cls: string) {
    const d = document.createElement('div');
    d.className = cls;
    d.style.display = 'none';
    this.o.overlay.appendChild(d);
    return d;
  }
}

// -----------------------------------------------------------------------------
// Utilitaires
// -----------------------------------------------------------------------------

/** Maillage plat (posé à l'horizontale), sans écriture de profondeur : jamais de z-fighting. */
function flatMesh(geo: THREE.BufferGeometry, color: string, opacity: number): THREE.Mesh {
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, fog: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 3;
  return m;
}

/** Anneau pointillé (arcs séparés) : « attaque refusée ». */
function dashedRing(inner: number, outer: number, dashes: number, color: string, opacity: number): THREE.Group {
  const g = new THREE.Group();
  const arc = (Math.PI * 2) / dashes;
  for (let i = 0; i < dashes; i++) {
    const m = flatMesh(new THREE.RingGeometry(inner, outer, 6, 1, i * arc, arc * 0.55), color, opacity);
    m.rotation.x = 0; // le groupe est couché ci-dessous
    g.add(m);
  }
  g.rotation.x = -Math.PI / 2;
  g.renderOrder = 3;
  return g;
}

/** Flèche plate dessinée vers −Z une fois couchée (pointe vers le haut de la forme). */
function arrowGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0.32);
  s.lineTo(0.26, 0.02);
  s.lineTo(0.1, 0.02);
  s.lineTo(0.1, -0.28);
  s.lineTo(-0.1, -0.28);
  s.lineTo(-0.1, 0.02);
  s.lineTo(-0.26, 0.02);
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

/** Points régulièrement espacés le long d'une polyligne (pour les pointillés). */
function sampleDots(pts: THREE.Vector3[], spacing: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = a.distanceTo(b);
    let d = carry;
    while (d < len) {
      out.push(a.clone().lerp(b, d / len));
      d += spacing;
    }
    carry = d - len;
  }
  out.push(pts[pts.length - 1].clone());
  return out.slice(1); // pas de point sous la pièce elle-même
}

function clear(g: THREE.Group) {
  for (const c of [...g.children]) {
    g.remove(c);
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | undefined;
      if (mat && !Array.isArray(mat)) mat.dispose();
    });
  }
}
