// Self-play : fait jouer les IA entre elles, sans rendu, et affiche un rapport.
//
//   npm run selfplay                       # duel Difficile/Moyen (50) + équité (100 par mode)
//   npm run selfplay -- --duel 10 --equity 20 --jobs 4 --hard-ms 1500
//   npm run selfplay -- --only equity
//
// Les parties sont réparties entre plusieurs processus (--jobs, par défaut le
// nombre de cœurs) : chaque processus rejoue la même liste de parties et ne
// traite que celles dont l'indice lui revient.
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { LocalEngine } from '../src/engine/engine';
import { AI_LEVELS, chooseMove, levelNumber, type AiLevel } from '../src/engine/ai/search';
import { TERRAIN_MODES, type TerrainMode } from '../src/engine/terrain';
import { RULES, type PlayerId } from '../src/engine/rules';

type Level = AiLevel | number;

interface Task {
  id: number;
  group: 'duel' | 'equity' | 'ladder';
  mode: TerrainMode;
  seed: string;
  levels: Record<PlayerId, Level>;
  /** Camp qui joue le premier coup. */
  first: PlayerId;
}

interface GameReport {
  id: number;
  group: Task['group'];
  mode: TerrainMode;
  levels: Record<PlayerId, Level>;
  first: PlayerId;
  winner: PlayerId | 'draw';
  reason: string;
  turns: number;
  hardMs: number[];
}

// --- Arguments ---------------------------------------------------------------
const args = process.argv.slice(2).filter((a) => a !== '--');
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const DUEL = Number(opt('duel', '50'));
const EQUITY = Number(opt('equity', '100'));
const ONLY = opt('only', 'all');
const HARD_MS = Number(opt('hard-ms', '1500'));
const JOBS = Number(opt('jobs', String(Math.max(1, cpus().length))));
const WORKER = opt('worker', '');
/** Qui commence : 1, 2, ou « alternate » (une partie sur deux avec J2 ; défaut). */
const FIRST = opt('first', 'alternate');
if (!['1', '2', 'alternate'].includes(FIRST)) throw new Error(`--first : 1, 2 ou alternate (reçu « ${FIRST} »)`);
/** Premier joueur de la partie n°i d'un groupe (parties d'une même seed groupées par paires). */
const firstFor = (i: number): PlayerId => (FIRST === 'alternate' ? ((i % 2 === 0 ? 1 : 2) as PlayerId) : (Number(FIRST) as PlayerId));
/** Échelle : chaque niveau contre le niveau inférieur, ex. --ladder 1-3,3-5,5-7,7-9,9-10 --ladder-games 8 */
const LADDER = opt('ladder', '');
const LADDER_GAMES = Number(opt('ladder-games', '8'));

function plan(): Task[] {
  const tasks: Task[] = [];
  if (LADDER)
    for (const pair of LADDER.split(',')) {
      const [lo, hi] = pair.split('-').map(Number);
      for (let i = 0; i < LADDER_GAMES; i++)
        tasks.push({
          id: tasks.length,
          group: 'ladder',
          mode: TERRAIN_MODES[Math.floor(i / 2) % TERRAIN_MODES.length].id,
          seed: `LAD-${pair}-${Math.floor(i / 2)}`,
          levels: i % 2 === 0 ? { 1: hi, 2: lo } : { 1: lo, 2: hi },
          first: firstFor(Math.floor(i / 2)),
        });
    }
  if (ONLY !== 'equity' && ONLY !== 'ladder')
    for (let i = 0; i < DUEL; i++) {
      // Difficile joue J1 une partie sur deux ; on fait tourner les modes de terrain.
      const hardFirst = i % 2 === 0;
      tasks.push({
        id: tasks.length,
        group: 'duel',
        mode: TERRAIN_MODES[Math.floor(i / 2) % TERRAIN_MODES.length].id,
        seed: `DUEL-${Math.floor(i / 2)}`,
        levels: hardFirst ? { 1: 'hard', 2: 'medium' } : { 1: 'medium', 2: 'hard' },
        first: firstFor(Math.floor(i / 2)),
      });
    }
  if (ONLY !== 'duel' && ONLY !== 'ladder')
    for (const m of TERRAIN_MODES)
      for (let i = 0; i < EQUITY; i++)
        // En alternance, deux parties consécutives partagent le même terrain (seed) avec un premier joueur différent.
        tasks.push({ id: tasks.length, group: 'equity', mode: m.id, seed: `EQ-${m.id}-${FIRST === 'alternate' ? Math.floor(i / 2) : i}`, levels: { 1: 'medium', 2: 'medium' }, first: firstFor(i) });
  return tasks;
}

function playGame(t: Task): GameReport {
  const eng = LocalEngine.create(t.mode, t.seed, null, t.first);
  const hardMs: number[] = [];
  let guard = 0;
  while (!eng.getState().result && guard++ < 1000) {
    const s = eng.getState();
    const level = t.levels[s.current];
    const r = chooseMove(s, { level, seed: `${t.seed}-${s.current}`, timeMs: HARD_MS });
    if (level === 'hard' || level === 9) hardMs.push(r.info.ms);
    if (!r.move) throw new Error(`Aucun coup renvoyé (partie ${t.id}, coup ${s.turn})`);
    eng.play(r.move); // les passes éventuelles sont jouées automatiquement par le moteur
  }
  const s = eng.getState();
  return { id: t.id, group: t.group, mode: t.mode, levels: t.levels, first: t.first, winner: s.result!.winner, reason: s.result!.reason, turns: s.turn, hardMs };
}

// --- Processus « ouvrier » -----------------------------------------------------
if (WORKER) {
  const [k, n] = WORKER.split('/').map(Number);
  for (const t of plan()) if (t.id % n === k) process.stdout.write(`R ${JSON.stringify(playGame(t))}\n`);
  process.exit(0);
}

// --- Processus principal ---------------------------------------------------------
const tasks = plan();
const results: GameReport[] = [];
const t0 = Date.now();
console.log(`Self-play : ${tasks.length} parties sur ${JOBS} processus (Difficile : ${HARD_MS} ms/coup)…`);

await Promise.all(
  Array.from({ length: JOBS }, (_, k) => {
    return new Promise<void>((resolve, reject) => {
      // On relance ce même script avec vite-node dans un processus enfant.
      const viteNode = fileURLToPath(new URL('../node_modules/vite-node/vite-node.mjs', import.meta.url));
      const self = fileURLToPath(import.meta.url);
      const child = spawn(process.execPath, [viteNode, self, '--', ...args, '--worker', `${k}/${JOBS}`], {
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      let buf = '';
      child.stdout.on('data', (d: Buffer) => {
        buf += d.toString();
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (!line.startsWith('R ')) continue;
          results.push(JSON.parse(line.slice(2)));
          process.stderr.write(`\r  ${results.length}/${tasks.length} parties jouées (${((Date.now() - t0) / 1000).toFixed(0)} s)   `);
        }
      });
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`processus ${k} : code ${code}`))));
    });
  }),
);
process.stderr.write('\n');

// --- Rapport ---------------------------------------------------------------------
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)} %` : '–');
const lines: string[] = [];
const out = (l = '') => lines.push(l);
const reasons = (rs: GameReport[]) => {
  const c: Record<string, number> = {};
  for (const r of rs) c[r.reason] = (c[r.reason] ?? 0) + 1;
  return Object.entries(c)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
};

out(`# Rapport de self-play — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
out();
const duel = results.filter((r) => r.group === 'duel');
if (duel.length) {
  const hardSide = (r: GameReport): PlayerId => (r.levels[1] === 'hard' ? 1 : 2);
  const hw = duel.filter((r) => r.winner === hardSide(r)).length;
  const draws = duel.filter((r) => r.winner === 'draw').length;
  const mw = duel.length - hw - draws;
  const decisive = hw + mw;
  const ms = duel.flatMap((r) => r.hardMs);
  const rate = decisive ? hw / decisive : 0;
  out(`## Difficile contre Moyen (${duel.length} parties)`);
  out();
  out(`| | Victoires | Défaites | Nulles | Taux (hors nulles) |`);
  out(`|---|---|---|---|---|`);
  for (const side of [1, 2] as PlayerId[]) {
    const g = duel.filter((r) => hardSide(r) === side);
    const w = g.filter((r) => r.winner === side).length;
    const d = g.filter((r) => r.winner === 'draw').length;
    out(`| Difficile en J${side} | ${w} | ${g.length - w - d} | ${d} | ${pct(w, g.length - d)} |`);
  }
  out(`| **Total** | **${hw}** | **${mw}** | **${draws}** | **${pct(hw, decisive)}** |`);
  out();
  out(`Fins de partie : ${reasons(duel)} · durée moyenne ${(duel.reduce((a, r) => a + r.turns, 0) / duel.length).toFixed(0)} coups`);
  out(`Temps de réflexion Difficile : moyenne ${(ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length)).toFixed(0)} ms, max ${Math.max(0, ...ms)} ms`);
  out(rate >= 0.7 ? `✅ Objectif atteint (≥ 70 % hors nulles).` : `⚠️ Objectif NON atteint : ${pct(hw, decisive)} < 70 % hors nulles.`);
  out();
}

const lad = results.filter((r) => r.group === 'ladder');
if (lad.length) {
  out(`## Échelle de difficulté (niveau supérieur contre niveau inférieur)`);
  out();
  out(`| Match | Parties | Victoires du plus fort | Défaites | Nulles | Taux (hors nulles) |`);
  out(`|---|---|---|---|---|---|`);
  const pairs = [...new Set(lad.map((r) => [r.levels[1], r.levels[2]].map((l) => levelNumber(l)).sort((a, b) => a - b).join('-')))];
  for (const pair of pairs) {
    const [lo, hi] = pair.split('-').map(Number);
    const g = lad.filter((r) => [r.levels[1], r.levels[2]].map((l) => levelNumber(l)).sort((a, b) => a - b).join('-') === pair);
    const strongSide = (r: GameReport): PlayerId => (levelNumber(r.levels[1]) === hi ? 1 : 2);
    const w = g.filter((r) => r.winner === strongSide(r)).length;
    const d = g.filter((r) => r.winner === 'draw').length;
    out(`| ${hi} ${AI_LEVELS[hi].name} contre ${lo} ${AI_LEVELS[lo].name} | ${g.length} | ${w} | ${g.length - w - d} | ${d} | ${pct(w, g.length - d)} |`);
  }
  out();
}

const eq = results.filter((r) => r.group === 'equity');
if (eq.length) {
  // Intervalle de Wilson à 95 % pour une proportion k/n (plus fiable que la normale sur petits échantillons).
  const wilson = (k: number, n: number): [number, number] => {
    if (!n) return [0, 1];
    const z = 1.96, p = k / n, d = 1 + (z * z) / n;
    const c = (p + (z * z) / (2 * n)) / d;
    const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
    return [c - h, c + h];
  };
  const pc = (x: number) => `${(100 * x).toFixed(0)}`;
  // Une ligne de stats pour un ensemble de parties : « premier joueur » = celui qui a joué le 1er coup.
  const stat = (g: GameReport[]) => {
    const wf = g.filter((r) => r.winner === r.first).length;
    const ws = g.filter((r) => r.winner !== 'draw' && r.winner !== r.first).length;
    const d = g.length - wf - ws;
    const [lo, hi] = wilson(wf, wf + ws);
    // Signalé : > 60 % ou < 40 % pour un camp, ou intervalle qui exclut 50 %.
    const share = wf + ws ? wf / (wf + ws) : 0.5;
    const flag = share > 0.6 || share < 0.4 || lo > 0.5 || hi < 0.5;
    return { wf, ws, d, share, lo, hi, flag };
  };
  const dur = (g: GameReport[]) => (g.reduce((a, r) => a + r.turns, 0) / g.length).toFixed(0);
  out(`## Équité des terrains — Moyen contre Moyen`);
  out();
  out(`Premier joueur = camp qui joue le 1er coup (${FIRST === 'alternate' ? 'alterné, même terrain pour chaque paire de parties' : `toujours J${FIRST}`}). IC = intervalle de Wilson à 95 % sur la part du premier joueur (hors nulles).`);
  out();
  out(`| Mode | Parties | 1er gagne | 2e gagne | Nulles | 1er (hors nulles) | IC 95 % | J1 gagne | J2 gagne | Fins | Durée moy. | |`);
  out(`|---|---|---|---|---|---|---|---|---|---|---|---|`);
  const flagged: string[] = [];
  const row = (label: string, g: GameReport[]) => {
    const st = stat(g);
    if (st.flag && label !== 'Total') flagged.push(`${label} (1er ${pct(st.wf, st.wf + st.ws)})`);
    const j1 = g.filter((r) => r.winner === 1).length;
    const j2 = g.filter((r) => r.winner === 2).length;
    out(
      `| ${label} | ${g.length} | ${st.wf} | ${st.ws} | ${st.d} | ${pct(st.wf, st.wf + st.ws)} | ${pc(st.lo)}–${pc(st.hi)} % | ${j1} | ${j2} | ${reasons(g)} | ${dur(g)} | ${st.flag ? '⚠️' : ''} |`,
    );
  };
  for (const m of TERRAIN_MODES) {
    const g = eq.filter((r) => r.mode === m.id);
    if (g.length) row(m.label, g);
  }
  row('Total', eq);
  out();
  out(flagged.length ? `⚠️ Déséquilibre (> 60 %, < 40 % ou IC excluant 50 %) : ${flagged.join(', ')}` : `✅ Aucun mode ne dépasse 60 % pour un camp (parties décisives).`);
  out();
  // Effet du coup de réponse final : parties allées à la limite de coups (fin « turnLimit » ou équivalent).
  const limit = eq.filter((r) => r.reason === 'moveLimit');
  out(`Parties arrivées à la limite de coups (${RULES.maxTurns}) : ${limit.length}/${eq.length} ; parmi elles, le premier joueur gagne ${limit.filter((r) => r.winner === r.first).length}, le second ${limit.filter((r) => r.winner !== 'draw' && r.winner !== r.first).length}, nulles ${limit.filter((r) => r.winner === 'draw').length}.`);
  for (const f of [1, 2] as PlayerId[]) {
    const g = eq.filter((r) => r.first === f);
    if (!g.length) continue;
    const w = g.filter((r) => r.winner === f).length;
    const l = g.filter((r) => r.winner !== 'draw' && r.winner !== f).length;
    out(`Quand J${f} commence (${g.length} parties) : J${f} gagne ${w}, adversaire ${l}, nulles ${g.length - w - l}.`);
  }
}
out();
out(`Durée totale : ${((Date.now() - t0) / 1000).toFixed(0)} s`);

const report = lines.join('\n');
console.log('\n' + report);
mkdirSync('reports', { recursive: true });
const file = `reports/selfplay-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.md`;
writeFileSync(file, report + '\n');
writeFileSync(file.replace('.md', '.json'), JSON.stringify(results));
console.log(`\nRapport enregistré : ${file}`);
