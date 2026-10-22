// Page principale (aperçu jouable) : terrain, pièces, sélection et déplacements.
import * as THREE from 'three';
import { RULES, type PlayerId } from './engine/rules';
import { TERRAIN_MODES, type TerrainMode } from './engine/terrain';
import { randomSeed } from './engine/random';
import { LocalEngine } from './engine/engine';
import { buildBoard, type BoardView } from './render/board';
import { buildClouds, buildIsland } from './render/environment';
import { createSceneKit } from './render/scene';
import { createCameraRig } from './render/camera';
import { GameView } from './render/game-view';
import { SKINS, skinById, type Skin } from './render/skins';
import { AiClient } from './ai/client';
import { SoundEngine, renderDemo, toWav } from './ui/sound';
import { GameClock, formatClock } from './ui/clock';
import type { TimeControl } from './engine/engine';
import { AI_LEVELS, levelNumber, type AiLevel } from './engine/ai/search';
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

const params = new URLSearchParams(location.search);
modeEl.value = params.get('mode') ?? 'random';
seedEl.value = (params.get('seed') ?? randomSeed()).toUpperCase();

let skin: Skin = skinById(params.get('skin'));
let engine: LocalEngine;
let board: BoardView | null = null;
let island: THREE.Group | null = null;
let view: GameView | null = null;

// ---------------------------------------------------------------------------
// Skins
// ---------------------------------------------------------------------------
const skinsEl = $('skins');
for (const s of SKINS) {
  const b = document.createElement('button');
  b.className = 'skin-btn';
  b.dataset.id = s.id;
  b.innerHTML = `<div class="sw"><span style="background:${s.hollow}"></span><span style="background:${s.low}"></span><span style="background:${s.high}"></span></div>${s.name}`;
  b.onclick = () => applySkin(s);
  skinsEl.appendChild(b);
}

function applySkin(s: Skin) {
  skin = s;
  document.documentElement.style.setProperty('--sky-top', s.sky.top);
  document.documentElement.style.setProperty('--sky-bottom', s.sky.bottom);
  (scene.fog as THREE.Fog).color.set(s.fog);
  clouds.setColor(s.cloud);
  for (const b of skinsEl.querySelectorAll<HTMLElement>('.skin-btn')) b.classList.toggle('active', b.dataset.id === s.id);
  if (island) scene.remove(island);
  island = buildIsland(RULES.board.size, s);
  scene.add(island);
  if (engine) rebuildBoard();
  updateUrl();
}

function rebuildBoard() {
  if (board) {
    scene.remove(board.group);
    board.dispose();
  }
  board = buildBoard(engine.getState().terrain, RULES.board.maxHeight, skin);
  scene.add(board.group);
  if (view) view.setBoard(board);
}

// ---------------------------------------------------------------------------
// Partie
// ---------------------------------------------------------------------------
function newGame() {
  const mode = modeEl.value as TerrainMode;
  const seed = seedEl.value.trim().toUpperCase() || randomSeed();
  seedEl.value = seed;
  engine = LocalEngine.create(mode, seed, timeControl());
  clock.reset();
  ai.cancel();
  gameToken++;
  thinking = false; // une réflexion de l'IA interrompue ne doit pas bloquer la nouvelle partie
  lastCurrent = 1;
  endPlayed = false;
  seenHistory = 0;
  hideEnd();
  view?.dispose();
  view = null;
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
  if ((e.target as HTMLElement).closest('.btn, .skin-btn')) sound.play({ type: 'ui' });
});
refreshSoundUi();
let gameToken = 0; // invalide les réponses d'une IA qui réfléchissait pour une partie abandonnée
let seenHistory = 0;
let thinking = false;

// --- Pendule -----------------------------------------------------------------------
const clock = new GameClock();
const cadenceEl = $<HTMLSelectElement>('cadence');
cadenceEl.value = params.get('cadence') ?? '10+0';
function timeControl(): TimeControl | null {
  if (cadenceEl.value === 'none') return null;
  const [m, inc] = cadenceEl.value.split('+').map(Number);
  return { minutes: m, incrementSec: inc };
}
cadenceEl.onchange = newGame; // une nouvelle cadence s'applique à une nouvelle partie
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
}
levelEl.oninput = () => {
  refreshLevelUi();
  updateUrl(); // s'applique dès le prochain coup de l'IA
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
  if (res.move) await view.playMove(res.move); // playMove appelle onStateChange à la fin
  else onStateChange();
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
    eliminated: w !== 'draw' ? `${NAMES[w === 1 ? 2 : 1]} n'a plus aucune pièce sur le plateau.` : '',
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
  updateUrl();
  // Si c'est désormais au tour de l'IA, elle joue.
  if (!thinking && engine && !engine.getState().result && aiLevel() && engine.getState().current === AI_PLAYER) void aiTurn();
};

function updateUrl() {
  try {
    history.replaceState(null, '', `?mode=${modeEl.value}&seed=${seedEl.value}&skin=${skin.id}&ai=${opponentEl.value === 'local' ? 'local' : levelEl.value}&cadence=${cadenceEl.value}`);
  } catch {
    /* aperçu hors serveur : sans importance */
  }
}

$('btn-new-game').onclick = newGame;
$('btn-new-seed').onclick = () => {
  seedEl.value = randomSeed();
  newGame();
};
modeEl.onchange = newGame;
seedEl.onkeydown = (e) => e.key === 'Enter' && newGame();
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
if (window.innerWidth < 760) ($('panel') as HTMLDetailsElement).open = false;

applySkin(skin);
newGame();

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
