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
import type { PlayerId } from '../src/engine/rules';

type Level = AiLevel | number;

interface Task {
  id: number;
  group: 'duel' | 'equity' | 'ladder';
  mode: TerrainMode;
  seed: string;
  levels: Record<PlayerId, Level>;
}

interface GameReport {
  id: number;
  group: Task['group'];
  mode: TerrainMode;
  levels: Record<PlayerId, Level>;
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
      });
    }
  if (ONLY !== 'duel' && ONLY !== 'ladder')
    for (const m of TERRAIN_MODES)
      for (let i = 0; i < EQUITY; i++)
        tasks.push({ id: tasks.length, group: 'equity', mode: m.id, seed: `EQ-${m.id}-${i}`, levels: { 1: 'medium', 2: 'medium' } });
  return tasks;
}

function playGame(t: Task): GameReport {
  const eng = LocalEngine.create(t.mode, t.seed);
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
  return { id: t.id, group: t.group, mode: t.mode, levels: t.levels, winner: s.result!.winner, reason: s.result!.reason, turns: s.turn, hardMs };
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
  out(`## Équité des terrains — Moyen contre Moyen`);
  out();
  out(`| Mode | Parties | J1 gagne | J2 gagne | Nulles | J1 (hors nulles) | Fins | Durée moy. | |`);
  out(`|---|---|---|---|---|---|---|---|---|`);
  const flagged: string[] = [];
  for (const m of TERRAIN_MODES) {
    const g = eq.filter((r) => r.mode === m.id);
    if (!g.length) continue;
    const w1 = g.filter((r) => r.winner === 1).length;
    const w2 = g.filter((r) => r.winner === 2).length;
    const d = g.length - w1 - w2;
    const share1 = w1 + w2 ? w1 / (w1 + w2) : 0.5;
    const flag = share1 > 0.6 || share1 < 0.4;
    if (flag) flagged.push(`${m.label} (${share1 > 0.6 ? 'J1' : 'J2'} ${pct(Math.max(w1, w2), w1 + w2)})`);
    out(
      `| ${m.label} | ${g.length} | ${pct(w1, g.length)} | ${pct(w2, g.length)} | ${pct(d, g.length)} | ${pct(w1, w1 + w2)} | ${reasons(g)} | ${(g.reduce((a, r) => a + r.turns, 0) / g.length).toFixed(0)} | ${flag ? '⚠️' : ''} |`,
    );
  }
  out();
  out(flagged.length ? `⚠️ Déséquilibre (> 60 % des parties décisives) : ${flagged.join(', ')}` : `✅ Aucun mode ne dépasse 60 % pour un camp (parties décisives).`);
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
