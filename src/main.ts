// Page principale (aperçu jouable) : terrain, pièces, sélection et déplacements.
import * as THREE from 'three';
import { RULES, type PlayerId } from './engine/rules';
import { TERRAIN_MODES, generateTerrain, type TerrainMode } from './engine/terrain';
import { randomSeed } from './engine/random';
import { LocalEngine } from './engine/engine';
import { buildBoard, type BoardView } from './render/board';
import { buildClouds, buildIsland } from './render/environment';
import { buildDecor, type DecorView } from './render/decor';
import { createSceneKit } from './render/scene';
import { createCameraRig } from './render/camera';
import { GameView } from './render/game-view';
import { skinForMode, type Skin } from './render/skins';
import { AiClient } from './ai/client';
import { SoundEngine, renderDemo, toWav } from './ui/sound';
import { GameClock, formatClock } from './ui/clock';
import type { TimeControl } from './engine/engine';
import { AI_LEVELS, levelNumber, type AiLevel } from './engine/ai/search';
import { setupRulesPanel } from './ui/rules-panel';
import { tally } from './engine/tally';
import { stateAtPly } from './engine/replay';
import { PIECES } from './engine/rules';
import { MODE_BLURB, drawTerrainPreview } from './ui/home';
import type { GameState } from './engine/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const app = $('app');
const { renderer, scene, camera } = createSceneKit(app, { shadowExtent: 9 });
const rig = createCameraRig(camera, renderer.domElement);
const clouds = buildClouds();
scene.add(clouds.group);

const modeEl = $<HTMLSelectElement>('mode');
const seedEl = $<HTMLInputElement>('seed');
for (const m of TERRAIN_MODES) modeEl.add(new Option(m.label, m.id));
const homeEl = $('home');

const params = new URLSearchParams(location.search);
modeEl.value = TERRAIN_MODES.some((m) => m.id === params.get('mode')) ? params.get('mode')! : 'random';
seedEl.value = (params.get('seed') ?? randomSeed()).toUpperCase();

// Le paramètre d'URL `skin=` des anciens liens est ignoré : le skin découle du terrain.
let skin: Skin = skinForMode(modeEl.value as TerrainMode);
let engine: LocalEngine;
let board: BoardView | null = null;
let island: THREE.Group | null = null;
let decor: DecorView | null = null;
let view: GameView | null = null;

// ---------------------------------------------------------------------------
// Skin (déterminé par le mode de terrain)
// ---------------------------------------------------------------------------
function applySkin(s: Skin) {
  skin = s;
  document.documentElement.style.setProperty('--sky-top', s.sky.top);
  document.documentElement.style.setProperty('--sky-bottom', s.sky.bottom);
  (scene.fog as THREE.Fog).color.set(s.fog);
  clouds.setColor(s.cloud);
  if (island) scene.remove(island);
  island = buildIsland(RULES.board.size, s);
  scene.add(island);
}

function rebuildBoard() {
  if (board) {
    scene.remove(board.group);
    board.dispose();
  }
  // Décor dépendant du mode (terrain) et du skin : libéré puis reconstruit à chaque partie / skin.
  if (decor) {
    scene.remove(decor.group);
    decor.dispose();
  }
  const terrain = engine.getState().terrain;
  board = buildBoard(terrain, RULES.board.maxHeight, skin);
  scene.add(board.group);
  decor = buildDecor(terrain, skin);
  scene.add(decor.group);
  if (view) view.setBoard(board);
}

// ---------------------------------------------------------------------------
// Partie
// ---------------------------------------------------------------------------
function newGame() {
  const mode = modeEl.value as TerrainMode;
  const seed = seedEl.value.trim().toUpperCase() || randomSeed();
  seedEl.value = seed;
  engine = LocalEngine.create(mode, seed, timeControl(), firstPlayer());
  homeEl.hidden = true;
  document.body.classList.remove('at-home');
  clock.reset();
  ai.cancel();
  gameToken++;
  thinking = false; // une réflexion de l'IA interrompue ne doit pas bloquer la nouvelle partie
  lastCurrent = engine.getState().current;
  endPlayed = false;
  seenHistory = 0;
  replayPly = null;
  hideEnd();
  view?.dispose();
  view = null;
  applySkin(skinForMode(mode)); // palette imposée par le terrain
  rebuildBoard();
  view = new GameView({
    scene,
    camera,
    dom: renderer.domElement,
    overlay: $('overlay'),
    engine,
    board: board!,
    onChange: onStateChange,
    scoreTarget: (p) => $(`score-${p}`),
    onSfx: (e) => sound.play(e),
    takeElapsed: () => clock.take(),
  });
  onStateChange();
  updateUrl();
}

// ---------------------------------------------------------------------------
// IA, passes et fin de partie
// ---------------------------------------------------------------------------
const NAMES: Record<PlayerId, string> = { 1: 'Corail', 2: 'Lagon' };
const COLORS: Record<PlayerId, string> = { 1: 'var(--coral)', 2: 'var(--lagoon)' };
const AI_PLAYER: PlayerId = 2; // l'IA joue Lagon
const ai = new AiClient();

// --- Son -----------------------------------------------------------------------
const sound = new SoundEngine();
let lastCurrent: PlayerId = 1;
let endPlayed = false;
// Le son ne peut démarrer qu'après un geste de l'utilisateur (règle des navigateurs).
for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, () => sound.unlock(), { capture: true });
const volumeEl = $<HTMLInputElement>('volume');
const ambienceEl = $<HTMLInputElement>('ambience');
const soundBtn = $('btn-sound');
function refreshSoundUi() {
  volumeEl.value = String(sound.settings.volume);
  ambienceEl.checked = sound.settings.ambience;
  soundBtn.classList.toggle('muted', sound.settings.muted);
  soundBtn.title = sound.settings.muted ? 'Réactiver le son (M)' : 'Couper le son (M)';
}
volumeEl.oninput = () => {
  sound.set({ volume: Number(volumeEl.value), muted: false });
  refreshSoundUi();
};
ambienceEl.onchange = () => sound.set({ ambience: ambienceEl.checked });
soundBtn.onclick = () => {
  sound.set({ muted: !sound.settings.muted });
  refreshSoundUi();
};
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'm' && !(e.target instanceof HTMLInputElement)) soundBtn.click();
});
// Petit « tic » sur tous les boutons de l'interface
document.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('.btn')) sound.play({ type: 'ui' });
});
refreshSoundUi();
let gameToken = 0; // invalide les réponses d'une IA qui réfléchissait pour une partie abandonnée
let seenHistory = 0;
let thinking = false;

// --- Pendule -----------------------------------------------------------------------
const clock = new GameClock();
const cadenceEl = $<HTMLSelectElement>('cadence');
// Dans une URL, « + » se lit comme un espace : « 10+0 » revient en « 10 0 ».
// On le rétablit, et toute valeur inconnue retombe sur la cadence par défaut
// (sinon le menu reste vide et la pendule démarre à 0 : défaite immédiate).
const urlCadence = (params.get('cadence') ?? '').replace(/ /g, '+');
cadenceEl.value = [...cadenceEl.options].some((o) => o.value === urlCadence) ? urlCadence : '10+0';
function timeControl(): TimeControl | null {
  if (cadenceEl.value === 'none') return null;
  const [m, inc] = cadenceEl.value.split('+').map(Number);
  if (!(m > 0) || !(inc >= 0)) return { minutes: 10, incrementSec: 0 };
  return { minutes: m, incrementSec: inc };
}
let lastTickSec = -1;

/** Rafraîchit l'affichage des pendules et fait tomber le drapeau à 0. */
function clockLoop() {
  if (engine && view) {
    const s = engine.getState();
    for (const p of [1, 2] as PlayerId[]) {
      const el = $(`clock-${p}`);
      el.hidden = !s.clock;
      if (!s.clock) continue;
      const left = clock.remaining(s, p);
      el.querySelector('b')!.textContent = formatClock(left);
      el.classList.toggle('active', !s.result && s.current === p);
      el.classList.toggle('low', left < 30_000);
    }
    if (s.clock && !s.result && clock.isRunning) {
      const left = clock.remaining(s, s.current);
      // Tic sonore pendant les 10 dernières secondes du joueur humain.
      const sec = Math.ceil(left / 1000);
      const human = !(aiLevel() && s.current === AI_PLAYER);
      if (human && left < 10_000 && sec !== lastTickSec) {
        lastTickSec = sec;
        sound.play({ type: 'tick', urgent: left < 5_000 });
      }
      if (left <= 0) {
        // Drapeau : plus de temps, le joueur au trait perd.
        clock.reset();
        if (thinking) {
          ai.cancel();
          thinking = false;
        }
        view.locked = false;
        engine.flag(s.current);
        view.sync();
        onStateChange();
      }
    }
  }
  requestAnimationFrame(clockLoop);
}
requestAnimationFrame(clockLoop);
const opponentEl = $<HTMLSelectElement>('opponent');
const aiSeedEl = $<HTMLInputElement>('ai-seed');
const levelEl = $<HTMLInputElement>('ai-level');
// Paramètre d'URL : ?ai=local, ?ai=1…10, ou les anciens noms easy / medium / hard.
{
  const p = params.get('ai') ?? '5';
  opponentEl.value = p === 'local' ? 'local' : 'ai';
  const n = Number(p);
  levelEl.value = String(Number.isFinite(n) && n >= 1 ? levelNumber(n) : p in { easy: 1, medium: 1, hard: 1 } ? levelNumber(p as AiLevel) : 5);
}
/** Niveau de l'IA (1 à 10), ou null en partie à 2 joueurs. */
const aiLevel = (): number | null => (opponentEl.value === 'local' ? null : Number(levelEl.value));
function refreshLevelUi() {
  const n = Number(levelEl.value);
  const cfg = AI_LEVELS[n];
  $('ai-level-num').textContent = String(n);
  $('ai-level-name').textContent = cfg.name;
  $('ai-level-hint').textContent = cfg.hint;
  $('ai-level-box').hidden = opponentEl.value === 'local';
  liveLevelEl.value = levelEl.value;
  $('ai-level-live-num').textContent = levelEl.value;
  $('live-level-box').hidden = opponentEl.value === 'local';
}
const liveLevelEl = $<HTMLInputElement>('ai-level-live');
levelEl.oninput = () => {
  refreshLevelUi();
  updateUrl(); // s'applique dès le prochain coup de l'IA
};
// Le curseur du panneau de jeu règle le même niveau que celui de l'accueil.
liveLevelEl.oninput = () => {
  levelEl.value = liveLevelEl.value;
  levelEl.oninput!(new Event('input'));
};
refreshLevelUi();

function onStateChange() {
  const s = engine.getState();
  refreshUndo();
  const label = TERRAIN_MODES.find((m) => m.id === s.terrain.mode)!.label;
  $('info').textContent = `${label} · seed ${s.terrain.seed}`;
  $('turn-dot').style.background = COLORS[s.current];
  const myTurnVsAi = aiLevel() && s.current !== AI_PLAYER;
  $('turn-text').textContent = s.result
    ? 'Partie terminée'
    : thinking
      ? `${NAMES[s.current]} réfléchit`
      : myTurnVsAi
        ? `À toi de jouer (${NAMES[s.current]})`
        : `${NAMES[s.current]} joue`;
  $('turn-text').parentElement!.classList.toggle('thinking', thinking);
  $('turn-count').textContent = String(s.turn);
  for (const p of [1, 2] as PlayerId[]) {
    // Sorties (2 = victoire) et points (Force des pièces sorties, utilisés à la limite de coups).
    const exited = s.pieces.filter((x) => x.player === p && x.status === 'exited').length;
    $(`score-${p}`).querySelector('b')!.textContent = String(exited);
    $(`score-${p}`).querySelector('em')!.textContent = `· ${s.score[p]} pt${s.score[p] > 1 ? 's' : ''}`;
  }

  renderTally(s);
  renderHistory(s);
  refreshReplayUi();

  // Passes survenues depuis le dernier affichage (le moteur les joue tout seul).
  const fresh = s.history.slice(seenHistory);
  seenHistory = s.history.length;
  const passes = fresh.filter((h) => h.pass);
  if (passes.length) sound.play({ type: 'pass', player: passes[0].player }, 0.3);
  if (passes.length === 1) toast(`${NAMES[passes[0].player]} n'a aucun coup légal et passe son tour`);
  else if (passes.length > 1) toast(`${passes.length} tours passés : aucun camp ne peut jouer`);

  if (s.result) {
    clock.reset();
    if (!endPlayed) {
      endPlayed = true;
      const w = s.result.winner;
      // Contre l'IA, la musique de fin dépend de mon résultat ; en local, toute victoire est fêtée.
      const outcome = w === 'draw' ? 'draw' : aiLevel() && w === AI_PLAYER ? 'lose' : 'win';
      sound.play({ type: 'end', outcome }, 0.6);
    }
    return showEnd(s);
  }
  if (s.current !== lastCurrent) {
    lastCurrent = s.current;
    if (!thinking) sound.play({ type: 'turn', player: s.current }, 0.25);
  }
  // La pendule du joueur au trait démarre (ou continue) : son temps de réflexion commence.
  if (s.clock) clock.start(s.current);
  if (thinking) return;
  if ($<HTMLInputElement>('follow').checked && !aiLevel()) rig.defaultView(s.current);
  if (aiLevel() && s.current === AI_PLAYER) void aiTurn();
}

async function aiTurn() {
  const level = aiLevel();
  if (!level || !view) return;
  const token = gameToken;
  thinking = true;
  view.locked = true; // pendant la réflexion : on ne peut pas jouer, mais on peut inspecter
  sound.play({ type: 'thinking' }, 0.3);
  onStateChange();
  const seed = aiSeedEl.value.trim() || `${engine.getState().terrain.seed}`;
  const t0 = performance.now();
  const st = engine.getState();
  // L'IA connaît son temps restant et règle sa réflexion en conséquence.
  const clockMs = st.clock ? clock.remaining(st, AI_PLAYER) : undefined;
  const res = await ai.think(structuredClone(st) as GameState, { level, seed, clockMs });
  if (token !== gameToken) return;
  clock.stop(); // seule la vraie réflexion est décomptée, pas la petite pause d'affichage
  // Laisser voir l'indicateur un instant, même si l'IA a répondu très vite.
  const wait = Math.max(0, 250 - (performance.now() - t0));
  await new Promise((r) => setTimeout(r, wait));
  if (token !== gameToken || !view) return;
  thinking = false;
  view.locked = false;
  if (res.move && view.replaying) {
    // Relecture affichée : l'IA joue en coulisses, sans animation ; un indicateur signale le nouveau coup.
    engine.play(res.move, clock.take());
    onStateChange();
  } else if (res.move) await view.playMove(res.move); // playMove appelle onStateChange à la fin
  else onStateChange();
}

// --- Historique et relecture ---------------------------------------------------------
/** Coup affiché en relecture (nombre d'enregistrements joués), ou null au présent. */
let replayPly: number | null = null;
/** Nombre de coups au moment d'entrer en relecture : sert à signaler les coups arrivés depuis. */
let replayBaseN = 0;
const histList = $('hist-list');

function renderHistory(s: GameState) {
  const N = s.history.length;
  $('hist-count').textContent = N ? `(${N})` : '';
  const active = replayPly ?? N;
  histList.innerHTML = s.history
    .map((h, i) => {
      const cls = `${h.pass ? 'pass ' : ''}${i + 1 === active ? 'cur' : ''}`;
      return `<li><button type="button" class="hist-row ${cls}" data-ply="${i + 1}" data-camp="${h.player}"><span class="hn">${i + 1}.</span><i data-camp="${h.player}"></i><span class="hnot">${h.notation}</span></button></li>`;
    })
    .join('');
  if (!N) histList.innerHTML = '<li class="hist-empty">Aucun coup joué</li>';
  const cur = histList.querySelector('.cur');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}
histList.onclick = (e) => {
  const row = (e.target as HTMLElement).closest<HTMLElement>('.hist-row');
  if (row) showPly(Number(row.dataset.ply));
};

function showPly(n: number) {
  if (!view || view.busy) return;
  const s = engine.getState();
  if (n >= s.history.length) return exitReplay();
  if (replayPly === null) replayBaseN = s.history.length;
  replayPly = Math.max(0, n);
  view.setReplay(new LocalEngine(stateAtPly(s, replayPly)));
  renderHistory(s);
  refreshReplayUi();
}
function exitReplay() {
  if (replayPly === null) return;
  replayPly = null;
  view?.setReplay(null);
  renderHistory(engine.getState());
  refreshReplayUi();
}
function refreshReplayUi() {
  const bar = $('replay-bar');
  bar.hidden = replayPly === null;
  document.body.classList.toggle('replaying', replayPly !== null);
  if (replayPly === null) return;
  const N = engine.getState().history.length;
  $('rpl-label').textContent = `Relecture – coup ${replayPly} / ${N}`;
  $<HTMLButtonElement>('rpl-prev').disabled = replayPly <= 0;
  $('rpl-new').hidden = N <= replayBaseN;
}
$('rpl-prev').onclick = () => replayPly !== null && showPly(replayPly - 1);
$('rpl-next').onclick = () => replayPly !== null && showPly(replayPly + 1);
$('rpl-live').onclick = exitReplay;
window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement | null;
  if (!engine || !view || e.ctrlKey || e.metaKey || e.altKey) return;
  if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
  if (!$('confirm').hidden || !$('end').hidden || document.querySelector('.rp-overlay:not([hidden])')) return;
  if (e.key === 'ArrowLeft') {
    const cur = replayPly ?? engine.getState().history.length;
    if (cur > 0) showPly(cur - 1);
    e.preventDefault();
  } else if (e.key === 'ArrowRight' && replayPly !== null) {
    showPly(replayPly + 1);
    e.preventDefault();
  } else if (e.key === 'Escape' && replayPly !== null) exitReplay();
});

/** Pastilles des pièces sorties et capturées de chaque camp (lettre = type, couleur = camp). */
function renderTally(s: GameState) {
  const t = tally(s);
  const chips = (types: string[], p: PlayerId, cls: string) =>
    types.length
      ? types.map((ty) => `<span class="pc pc-${p} ${cls}" title="${PIECES[ty as keyof typeof PIECES].name}">${PIECES[ty as keyof typeof PIECES].letter}</span>`).join('')
      : '<span class="pc-none">—</span>';
  for (const p of [1, 2] as PlayerId[]) {
    $(`tally-${p}`).innerHTML =
      `<i data-camp="${p}"></i><span class="tl-grp"><small>Sorties</small>${chips(t[p].exited, p, 'ex')}<em>${t[p].points} pt${t[p].points > 1 ? 's' : ''}</em></span>` +
      `<span class="tl-grp"><small>Capturées</small>${chips(t[p].captured, p, 'cap')}</span>`;
  }
}

function toast(msg: string) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout((toast as unknown as { t?: number }).t);
  (toast as unknown as { t?: number }).t = window.setTimeout(() => el.classList.remove('show'), 2800);
}

function showEnd(s: GameState) {
  const r = s.result!;
  const w = r.winner;
  const card = $('end');
  $('end-badge').style.background = w === 'draw' ? 'linear-gradient(90deg, var(--coral) 50%, var(--lagoon) 50%)' : COLORS[w];
  $('end-badge').style.color = w === 'draw' ? '#ccc' : COLORS[w];
  const vsAi = aiLevel();
  $('end-title').textContent =
    w === 'draw' ? 'Partie nulle' : vsAi ? (w === AI_PLAYER ? "L'IA l'emporte" : 'Victoire !') : `${NAMES[w]} l'emporte`;
  const sc = `${s.score[1]} à ${s.score[2]}`;
  const reasons: Record<string, string> = {
    sentinel: w !== 'draw' ? `La Sentinelle de ${NAMES[w]} est sortie : victoire immédiate.` : '',
    secondExit: w !== 'draw' ? `${NAMES[w]} a fait sortir sa deuxième pièce.` : '',
    eliminated:
      w === 'draw'
        ? `Plus aucune pièce sur le plateau pour un camp, et l'autre ne peut au mieux qu'égaliser (${sc}).`
        : s.pieces.some((x) => x.player === w && x.status === 'board')
          ? `${NAMES[w === 1 ? 2 : 1]} n'a plus aucune pièce sur le plateau.`
          : `${NAMES[w]} a sorti sa dernière pièce et ne peut plus être rattrapé (${sc}).`,
    score: w === 'draw' ? `Deux pièces sont sorties et les scores sont à égalité (${sc}).` : `Deux pièces sont sorties : ${NAMES[w]} mène ${sc} au score.`,
    time: w !== 'draw' ? `Temps écoulé : ${NAMES[w === 1 ? 2 : 1]} n'a plus de temps à sa pendule.` : '',
    moveLimit:
      s.score[1] || s.score[2]
        ? `Limite de ${RULES.maxTurns} coups atteinte : ${w === 'draw' ? `égalité au score (${sc})` : `${NAMES[w]} a le meilleur score (${sc})`}.`
        : `Limite de ${RULES.maxTurns} coups atteinte sans sortie : ${w === 'draw' ? 'pièces les plus avancées à égalité (rangées et Force).' : `la pièce la plus avancée de ${NAMES[w]} est la plus proche de la sortie.`}`,
  };
  $('end-reason').textContent = reasons[r.reason];
  $('end-score').innerHTML = ([1, 2] as PlayerId[])
    .map((p) => {
      const ex = s.pieces.filter((x) => x.player === p && x.status === 'exited').length;
      return `<span><i style="background:${COLORS[p]}"></i>${NAMES[p]} <b>${ex}</b> sortie${ex > 1 ? 's' : ''} · ${s.score[p]} pt${s.score[p] > 1 ? 's' : ''}</span>`;
    })
    .join('');
  card.hidden = false;
}
function hideEnd() {
  $('end').hidden = true;
}
$('end-close').onclick = hideEnd;
$('end-new').onclick = () => {
  seedEl.value = randomSeed();
  newGame();
};
$('end-replay').onclick = newGame;
opponentEl.onchange = () => {
  refreshLevelUi();
  refreshFirstLabels();
};

// Qui commence : Corail, Lagon ou tiré au sort à chaque nouvelle partie.
const firstEl = $<HTMLSelectElement>('first');
if (['1', '2', 'random'].includes(params.get('first') ?? '')) firstEl.value = params.get('first')!;
function firstPlayer(): PlayerId {
  if (firstEl.value === 'random') return Math.random() < 0.5 ? 1 : 2;
  return firstEl.value === '2' ? 2 : 1;
}
/** Contre l'IA, on précise qui est qui dans le menu. */
function refreshFirstLabels() {
  const vsAi = opponentEl.value !== 'local';
  firstEl.options[0].text = vsAi ? 'Corail (toi)' : 'Corail';
  firstEl.options[1].text = vsAi ? "Lagon (l'IA)" : 'Lagon';
}

function updateUrl() {
  try {
    history.replaceState(null, '', `?mode=${modeEl.value}&seed=${seedEl.value}&ai=${opponentEl.value === 'local' ? 'local' : levelEl.value}&cadence=${encodeURIComponent(cadenceEl.value)}&first=${firstEl.value}`);
  } catch {
    /* aperçu hors serveur : sans importance */
  }
}

// --- Accueil -----------------------------------------------------------------------
const chipsEl = $('terrain-chips');
for (const m of TERRAIN_MODES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.dataset.mode = m.id;
  b.textContent = m.label;
  b.setAttribute('role', 'radio');
  b.onclick = () => {
    modeEl.value = m.id;
    refreshHome();
  };
  chipsEl.appendChild(b);
}
let previewTimer = 0;
/** Met l'accueil à jour : puces, description, mini-aperçu et plateau 3D visible derrière la fiche. */
function refreshHome() {
  const mode = modeEl.value as TerrainMode;
  for (const b of chipsEl.children) b.setAttribute('aria-checked', String((b as HTMLElement).dataset.mode === mode));
  $('terrain-desc').textContent = MODE_BLURB[mode];
  const seed = seedEl.value.trim().toUpperCase() || 'HASARD';
  drawTerrainPreview($<HTMLCanvasElement>('terrain-preview'), generateTerrain(mode, seed).heights, skinForMode(mode), RULES.board.maxHeight);
  clearTimeout(previewTimer);
  previewTimer = window.setTimeout(previewBoard, 150);
}
/** Plateau d'ambiance derrière l'accueil (aucune partie n'est lancée). */
function previewBoard() {
  if (view || homeEl.hidden) return;
  const mode = modeEl.value as TerrainMode;
  engine = LocalEngine.create(mode, seedEl.value.trim().toUpperCase() || 'HASARD', null, 1);
  applySkin(skinForMode(mode));
  rebuildBoard();
}
function showHome() {
  ai.cancel();
  gameToken++;
  thinking = false;
  clock.reset();
  hideEnd();
  replayPly = null;
  view?.dispose();
  view = null;
  homeEl.hidden = false;
  document.body.classList.add('at-home');
  try {
    history.replaceState(null, '', params.has('debug') ? '?debug' : location.pathname);
  } catch {
    /* sans importance */
  }
  if (!seedEl.value.trim()) seedEl.value = randomSeed();
  refreshHome();
  rig.defaultView(1);
}
$('btn-play').onclick = () => {
  if (!seedEl.value.trim()) seedEl.value = randomSeed();
  newGame();
};
$('btn-home-rules').onclick = () => $('btn-rules').click();
// Partie en cours = au moins un coup joué et pas de résultat : on demande confirmation avant de la perdre.
const inProgress = () => !!engine && !!view && !engine.getState().result && engine.getState().history.length > 0;
function askConfirm(title: string, text: string, okLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    $('confirm-ok').textContent = okLabel;
    $('confirm').hidden = false;
    const done = (v: boolean) => {
      $('confirm').hidden = true;
      window.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        done(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    $('confirm-ok').onclick = () => done(true);
    $('confirm-cancel').onclick = () => done(false);
  });
}
async function goMenu() {
  if (inProgress() && !(await askConfirm('Retourner au menu ?', 'La partie en cours sera abandonnée.', 'Retour au menu'))) return;
  showHome();
}
async function restart() {
  if (inProgress() && !(await askConfirm('Recommencer ?', 'Même terrain, même seed, mêmes options : la partie en cours sera perdue.', 'Recommencer'))) return;
  newGame();
}
$('btn-menu').onclick = goMenu;
$('end-menu').onclick = showHome;
$('btn-restart').onclick = restart;
$('btn-new-seed').onclick = () => {
  seedEl.value = randomSeed();
  refreshHome();
};
modeEl.onchange = refreshHome;
seedEl.oninput = refreshHome;
seedEl.onkeydown = (e) => e.key === 'Enter' && $('btn-play').click();
// --- Annuler un coup ------------------------------------------------------------
const undoBtn = $<HTMLButtonElement>('btn-undo');
const endUndoBtn = $<HTMLButtonElement>('end-undo');

/**
 * Peut-on annuler ? Il faut un coup à défaire : contre l'IA, un coup du joueur humain
 * (on annule alors aussi la réponse de l'IA). Une défaite au temps ne s'annule pas :
 * la pendule resterait à zéro.
 */
function canUndo(): boolean {
  if (!engine || !view || view.busy) return false;
  const s = engine.getState();
  if (s.result?.reason === 'time') return false;
  return s.history.some((h) => h.move && (!aiLevel() || h.player !== AI_PLAYER));
}

function refreshUndo() {
  const ok = canUndo();
  undoBtn.disabled = !ok;
  endUndoBtn.hidden = !ok;
}

function undoMove() {
  if (!canUndo()) return;
  exitReplay();
  // Si l'IA est en train de réfléchir, on interrompt sa réflexion.
  if (thinking) {
    ai.cancel();
    gameToken++; // la réponse éventuelle de l'IA sera ignorée
    thinking = false;
    view!.locked = false;
  }
  sound.play({ type: 'undo' });
  engine.undo();
  // Contre l'IA, on revient jusqu'à son propre tour (on annule aussi la réponse de l'IA).
  while (aiLevel() && engine.getState().current === AI_PLAYER && engine.getState().history.length) engine.undo();
  seenHistory = engine.getState().history.length;
  lastCurrent = engine.getState().current;
  clock.reset();
  endPlayed = false;
  hideEnd();
  view!.sync();
  onStateChange();
  toast('Coup annulé');
}
undoBtn.onclick = undoMove;
endUndoBtn.onclick = undoMove;
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(e.target instanceof HTMLInputElement)) {
    e.preventDefault();
    undoMove();
  }
});
$('btn-default').onclick = () => rig.defaultView(engine.getState().current);
$('btn-top').onclick = () => rig.topView();
$<HTMLInputElement>('follow').onchange = (e) => (e.target as HTMLInputElement).checked && rig.defaultView(engine.getState().current);
// Sur petit écran, le panneau démarre replié.
if (window.innerWidth < 700) ($('panel') as HTMLDetailsElement).open = false;

setupRulesPanel($('btn-rules'));
applySkin(skin);
refreshFirstLabels();
// Lien partagé (mode, seed, adversaire…) : on lance la partie directement ; sinon, accueil.
if (['mode', 'seed', 'ai', 'cadence', 'first'].some((k) => params.has(k))) newGame();
else showHome();

// Accès de débogage (tests automatisés) : ?debug dans l'URL.
if (params.has('debug')) {
  (window as unknown as Record<string, unknown>).__altara = {
    engine: () => engine,
    sound,
    ai,
    /** Démo sonore rendue hors-ligne → WAV encodé en base64 + repères. */
    async soundDemo(amb = 20) {
      const { buffer, marks } = await renderDemo(amb);
      const bytes = new Uint8Array(toWav(buffer));
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const peaks = marks.map((m, i) => {
        const end = marks[i + 1]?.at ?? buffer.duration;
        let pk = 0;
        let sum = 0;
        let n = 0;
        for (let c = 0; c < 2; c++) {
          const d = buffer.getChannelData(c);
          for (let k = Math.floor(m.at * buffer.sampleRate); k < Math.floor(end * buffer.sampleRate); k++) {
            pk = Math.max(pk, Math.abs(d[k]));
            sum += d[k] * d[k];
            n++;
          }
        }
        return { label: m.label, peakDb: +(20 * Math.log10(pk || 1e-9)).toFixed(1), rmsDb: +(10 * Math.log10(sum / n || 1e-12)).toFixed(1) };
      });
      return { wav: btoa(bin), peaks, duration: buffer.duration };
    },
    board: () => board,
    view: () => view,
    camera,
    /** Position écran (px) du dessus d'une case. */
    screenOf(row: number, col: number, dy = 0) {
      const v = board!.cellTop(row, col).add(new THREE.Vector3(0, dy, 0)).project(camera);
      return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
    },
  };
}

const frameClock = new THREE.Clock();
function frame() {
  const dt = Math.min(frameClock.getDelta(), 0.1);
  clouds.update(dt);
  rig.update(dt);
  view?.update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
