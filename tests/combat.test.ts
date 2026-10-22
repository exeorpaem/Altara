import { describe, expect, it } from 'vitest';
import { legalMoves } from '../src/engine/movement';
import { LocalEngine } from '../src/engine/engine';
import { dest, flat, piece, state } from './helpers';
import type { Move } from '../src/engine/types';

const attackOn = (moves: Move[], targetId: string) => moves.find((m) => m.kind === 'attack' && m.targetId === targetId);

describe('combat — exemples officiels', () => {
  it('Avant-garde (h=1) contre Avant-garde (h=0) avec 1 renfort : 3 contre 3 → capture', () => {
    const atk = piece('vanguard', 1, 4, 4);
    const def = piece('vanguard', 2, 4, 6);
    const help = piece('explorer', 2, 5, 6); // renfort du défenseur
    const g = state(flat([[4, 4, 1]]), [atk, def, help]);
    const eng = new LocalEngine(g);
    const move = attackOn(eng.getLegalMoves(atk.id), def.id)!;
    expect(move).toBeDefined();
    expect(move.cost).toBe(3); // descente (2) + entrée à plat (1) : pas de charge
    const pv = eng.previewAttack(move);
    expect(pv.attack).toBe(3);
    expect(pv.defense).toBe(3);
    expect(pv.details).toContain('+1 hauteur (attaque depuis plus haut)');
    expect(pv.details).toContain('+1 renfort (Explorateur)');

    eng.play(move);
    const s = eng.getState();
    expect(s.pieces.find((p) => p.id === def.id)!.status).toBe('captured');
    // L'attaquant prend la case du défenseur et le tour passe.
    expect(s.pieces.find((p) => p.id === atk.id)).toMatchObject({ row: 4, col: 6, status: 'board' });
    expect(s.current).toBe(2);
    expect(s.history.at(-1)!.capturedId).toBe(def.id);
  });

  it('Explorateur contre Sentinelle, avec une Avant-garde alliée adjacente à la cible : 3 contre 3 → capture', () => {
    const atk = piece('explorer', 1, 4, 2);
    const def = piece('sentinel', 2, 4, 4);
    const ally = piece('vanguard', 1, 5, 4);
    const eng = new LocalEngine(state(flat(), [atk, def, ally]));
    const move = attackOn(eng.getLegalMoves(atk.id), def.id)!;
    expect(move).toBeDefined();
    const pv = eng.previewAttack(move);
    expect([pv.attack, pv.defense]).toEqual([3, 3]);
    expect(pv.details).toContain('+2 allié (Avant-garde)');
    eng.play(move);
    expect(eng.getState().pieces.find((p) => p.id === def.id)!.status).toBe('captured');
  });
});

describe('combat — modificateurs', () => {
  it('malus en montée : attaquer plus haut coûte 1 point de force', () => {
    const atk = piece('sentinel', 1, 4, 4);
    const def = piece('sentinel', 2, 4, 5);
    const h = flat([[4, 5, 1]]);
    // 3 − 1 = 2 contre 3 : illégal, non proposé
    expect(attackOn(legalMoves(state(h, [atk, def]), atk.id), def.id)).toBeUndefined();
    // Avec un Explorateur allié adjacent à la cible : 2 + 1 = 3 contre 3 → légal
    const ally = piece('explorer', 1, 3, 5);
    const eng = new LocalEngine(state(h, [atk, def, ally]));
    const move = attackOn(eng.getLegalMoves(atk.id), def.id)!;
    expect(move).toBeDefined();
    const pv = eng.previewAttack(move);
    expect([pv.attack, pv.defense]).toEqual([3, 3]);
    expect(pv.details).toContain('−1 hauteur (attaque en montée)');
  });

  it("la hauteur se compare depuis la case de départ de l'attaquant, pas depuis la case d'appui", () => {
    // Départ à h=0, case d'appui à h=1, cible à h=1 → départ plus bas : −1
    const atk = piece('sentinel', 1, 4, 3);
    const def = piece('explorer', 2, 4, 5);
    const eng = new LocalEngine(state(flat([[4, 4, 1], [4, 5, 1]]), [atk, def]));
    const pv = eng.previewAttack(attackOn(eng.getLegalMoves(atk.id), def.id)!);
    expect(pv.attack).toBe(2);
  });

  it("charge de l'Avant-garde : chemin de coût 4 → +1", () => {
    const atk = piece('vanguard', 1, 4, 0);
    const def = piece('vanguard', 2, 4, 4);
    const help = piece('explorer', 2, 5, 4);
    const eng = new LocalEngine(state(flat(), [atk, def, help]));
    const move = attackOn(eng.getLegalMoves(atk.id), def.id)!;
    expect(move.cost).toBe(4);
    const pv = eng.previewAttack(move);
    expect([pv.attack, pv.defense]).toEqual([3, 3]);
    expect(pv.details).toContain('+1 charge (chemin de coût 4)');
  });

  it('charge : chemin de coût 3 → pas de bonus (2 contre 3, attaque refusée)', () => {
    const atk = piece('vanguard', 1, 4, 1);
    const def = piece('vanguard', 2, 4, 4);
    const help = piece('explorer', 2, 5, 4);
    const moves = legalMoves(state(flat(), [atk, def, help]), atk.id);
    expect(attackOn(moves, def.id)).toBeUndefined();
    // Sans renfort, 2 contre 2 : légal, et sans charge
    const eng = new LocalEngine(state(flat(), [atk, def]));
    const move = attackOn(eng.getLegalMoves(atk.id), def.id)!;
    expect(move.cost).toBe(3);
    expect(eng.previewAttack(move).details.some((d) => d.includes('charge'))).toBe(false);
  });

  it("la charge ne concerne que l'Avant-garde", () => {
    const atk = piece('explorer', 1, 4, 0);
    const def = piece('explorer', 2, 4, 4);
    const eng = new LocalEngine(state(flat(), [atk, def]));
    const move = attackOn(eng.getLegalMoves(atk.id), def.id)!;
    expect(move.cost).toBe(4);
    expect(eng.previewAttack(move).attack).toBe(1);
  });

  it('attaque illégale si plus faible (Explorateur seul contre Sentinelle)', () => {
    const atk = piece('explorer', 1, 4, 3);
    const def = piece('sentinel', 2, 4, 4);
    const moves = legalMoves(state(flat(), [atk, def]), atk.id);
    expect(attackOn(moves, def.id)).toBeUndefined();
    // et la case de la cible n'apparaît sous aucune forme
    expect(moves.some((m) => dest(m).row === 4 && dest(m).col === 4)).toBe(false);
  });

  it("les alliés de l'attaquant s'additionnent ; chaque renfort ajoute 1", () => {
    const atk = piece('explorer', 1, 4, 2);
    const def = piece('sentinel', 2, 4, 4);
    const a1 = piece('explorer', 1, 3, 4);
    const a2 = piece('vanguard', 1, 5, 4);
    const r1 = piece('explorer', 2, 4, 5);
    const eng = new LocalEngine(state(flat(), [atk, def, a1, a2, r1]));
    const pv = eng.previewAttack(attackOn(eng.getLegalMoves(atk.id), def.id)!);
    expect(pv.attack).toBe(1 + 1 + 2);
    expect(pv.defense).toBe(3 + 1);
  });

  it("l'attaquant ne compte pas comme son propre allié quand il part d'une case adjacente", () => {
    const atk = piece('vanguard', 1, 4, 3);
    const def = piece('vanguard', 2, 4, 4);
    const eng = new LocalEngine(state(flat(), [atk, def]));
    const move = attackOn(eng.getLegalMoves(atk.id), def.id)!;
    expect(move.path).toHaveLength(2);
    expect(eng.previewAttack(move).attack).toBe(2);
  });
});

describe('attaques refusées (anneau gris)', () => {
  it('trop faible : à portée, mais attaque < défense (2 contre 3)', () => {
    const v = piece('vanguard', 1, 4, 3);
    const s = piece('sentinel', 2, 4, 5);
    const eng = new LocalEngine(state(flat(), [v, s]));
    expect(eng.getLegalMoves(v.id).some((m) => m.kind === 'attack')).toBe(false);
    const [b] = eng.getBlockedAttacks(v.id);
    expect(b).toMatchObject({ targetId: s.id, reason: 'weak', attack: 2, defense: 3, cost: 2 });
    expect(b.path.at(-1)).toEqual({ row: 4, col: 5 });
  });

  it("hors de portée : la case voisine coûte 3, l'entrée en montée coûte 2 → 5 > 4", () => {
    // Avant-garde en (4,3) h0 ; case d'appui (4,4) h2 (montée : 3) ; Sentinelle en (4,5) h0 (descente : 3)
    // Autour : murs pour qu'aucune autre approche ne soit moins chère.
    const h = flat([[4, 4, 2], [3, 5, 6], [5, 5, 6], [4, 6, 6], [3, 4, 6], [5, 4, 6]]);
    const v = piece('vanguard', 1, 4, 3);
    const s = piece('sentinel', 2, 4, 5);
    const eng = new LocalEngine(state(h, [v, s]));
    const [b] = eng.getBlockedAttacks(v.id);
    expect(b).toMatchObject({ targetId: s.id, reason: 'range', cost: 6 });
    expect(b.attack).toBeUndefined();
  });

  it("une attaque légale (charge à coût 4) n'apparaît pas parmi les refus", () => {
    const v = piece('vanguard', 1, 4, 0);
    const d = piece('vanguard', 2, 4, 4);
    const help = piece('explorer', 2, 5, 4);
    const eng = new LocalEngine(state(flat(), [v, d, help]));
    expect(eng.getLegalMoves(v.id).some((m) => m.kind === 'attack' && m.targetId === d.id)).toBe(true);
    expect(eng.getBlockedAttacks(v.id).map((b) => b.targetId)).not.toContain(d.id);
  });

  it('les ennemis hors de vue ne sont pas signalés', () => {
    const v = piece('vanguard', 1, 0, 0);
    const far = piece('sentinel', 2, 9, 9);
    expect(new LocalEngine(state(flat(), [v, far])).getBlockedAttacks(v.id)).toHaveLength(0);
  });
});
