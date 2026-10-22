// Sound design d'Altara : tout est synthétisé avec la Web Audio API (aucun fichier).
//
// Intention : un jeu de réflexion calme, « boîte à musique de verre et de bois ».
//  - Une seule gamme pour tout le jeu : ré majeur pentatonique (ré, mi, fa♯, la, si).
//    Aucune combinaison de notes ne peut sonner faux, même quand les sons se chevauchent.
//  - Chaque camp a sa voix : Corail (chaleureux, centré sur ré, timbre de bois/marimba),
//    Lagon (aérien, centré sur la, timbre de verre/cloche).
//  - Chaque pièce a son registre : Explorateur aigu, Avant-garde médium, Sentinelle grave.
//  - Les pas sont des « toc » de bois dont la hauteur suit l'altitude de la case :
//    on entend le relief.
//  - Une réverbération (générée) donne de l'espace ; un compresseur évite toute saturation.
//
// Organisation : `Synth` sait jouer chaque son à un instant donné, sur n'importe quel
// contexte audio (temps réel ou hors-ligne pour la démo) ; `SoundEngine` gère le
// contexte du navigateur, le volume, la sourdine et l'ambiance.
import type { PieceType, PlayerId } from '../engine/rules';
import type { ViewSfx } from '../render/game-view';

export type Sfx =
  | ViewSfx
  | { type: 'turn'; player: PlayerId }
  | { type: 'pass'; player: PlayerId }
  | { type: 'end'; outcome: 'win' | 'lose' | 'draw' }
  | { type: 'thinking' }
  | { type: 'ui' }
  | { type: 'tick'; urgent: boolean }
  | { type: 'undo' };

// -----------------------------------------------------------------------------
// Notes
// -----------------------------------------------------------------------------

const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);
/** Classes de hauteur de ré majeur pentatonique : ré, mi, fa♯, la, si. */
const PCS = new Set([2, 4, 6, 9, 11]);
const inScale = (m: number) => PCS.has(((m % 12) + 12) % 12);
/**
 * i-ème note de la gamme à partir de `base` (ramenée d'abord sur la gamme).
 * i négatif = on descend. Toutes les mélodies du jeu passent par là.
 */
function degree(base: number, i: number): number {
  let n = base;
  while (!inScale(n)) n++;
  for (let k = i; k > 0; k--) do n++; while (!inScale(n));
  for (let k = i; k < 0; k++) do n--; while (!inScale(n));
  return n;
}
/** Tonique de chaque camp. */
const ROOT: Record<PlayerId, number> = { 1: 62, 2: 69 }; // ré4 / la4
/** Registre des pièces (en degrés de gamme) : Explorateur aigu, Sentinelle grave. */
const REG: Record<PieceType, number> = { explorer: 3, vanguard: 1, sentinel: -2 };

// -----------------------------------------------------------------------------
// Synthétiseur
// -----------------------------------------------------------------------------

interface VoiceOpts {
  freq: number;
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  decay?: number;
  /** Glissando vers cette fréquence (en `glideTime` secondes). */
  glideTo?: number;
  glideTime?: number;
  /** Envoi vers la réverbération (0 à 1). */
  rev?: number;
  pan?: number;
  lowpass?: number;
  detune?: number;
}

interface NoiseOpts {
  dur: number;
  gain: number;
  filter?: BiquadFilterType;
  freq: number;
  q?: number;
  sweepTo?: number;
  attack?: number;
  rev?: number;
  pan?: number;
}

export class Synth {
  readonly out: GainNode; // bus des effets
  readonly music: GainNode; // bus de l'ambiance
  private verb: GainNode;
  private noiseBuf: AudioBuffer;
  private rnd: () => number;

  constructor(
    readonly ctx: BaseAudioContext,
    dest: AudioNode,
    seed = 1,
  ) {
    // Petit générateur pseudo-aléatoire : le rendu hors-ligne est reproductible.
    let a = seed >>> 0;
    this.rnd = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    // Compresseur doux en sortie : les sons qui s'empilent ne saturent jamais.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    comp.connect(dest);

    this.out = ctx.createGain();
    this.music = ctx.createGain();
    this.out.connect(comp);
    this.music.connect(comp);

    // Réverbération à convolution : la réponse impulsionnelle est un bruit stéréo
    // qui décroît en exponentielle (≈ une salle de pierre douce de 2,6 s).
    const conv = ctx.createConvolver();
    conv.buffer = this.impulse(2.6, 2.8);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.verb = ctx.createGain();
    this.verb.connect(conv);
    conv.connect(wet);
    wet.connect(comp);

    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = this.rnd() * 2 - 1;
  }

  private impulse(seconds: number, decay: number): AudioBuffer {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (this.rnd() * 2 - 1) * (1 - i / len) ** decay;
    }
    return buf;
  }

  /** Branche une source vers le bus `bus` (sec) et la réverbération (envoi `rev`), avec panoramique. */
  private route(node: AudioNode, rev = 0.25, pan = 0, bus: AudioNode = this.out) {
    let last: AudioNode = node;
    if (pan) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      node.connect(p);
      last = p;
    }
    last.connect(bus);
    if (rev > 0) {
      const send = this.ctx.createGain();
      send.gain.value = rev;
      last.connect(send);
      send.connect(this.verb);
    }
  }

  /** Enveloppe percussive : montée linéaire puis décroissance exponentielle. */
  private env(param: AudioParam, t: number, peak: number, attack: number, decay: number) {
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  /** Oscillateur simple avec enveloppe (et glissando, filtre facultatifs). */
  voice(t: number, o: VoiceOpts, bus?: AudioNode) {
    const { ctx } = this;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.detune) osc.detune.value = o.detune;
    if (o.glideTo) osc.frequency.exponentialRampToValueAtTime(o.glideTo, t + (o.glideTime ?? 0.1));
    const g = ctx.createGain();
    const attack = o.attack ?? 0.004;
    const decay = o.decay ?? 0.4;
    this.env(g.gain, t, o.gain ?? 0.2, attack, decay);
    let src: AudioNode = osc;
    if (o.lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lowpass;
      osc.connect(f);
      src = f;
    }
    src.connect(g);
    this.route(g, o.rev ?? 0.25, o.pan ?? 0, bus);
    osc.start(t);
    osc.stop(t + attack + decay + 0.05);
  }

  /**
   * Cloche en synthèse FM : un modulateur fait vibrer la fréquence du porteur.
   * Rapport entier (2) → cloche douce ; rapport non entier (3,5) → verre, cristal.
   * L'indice de modulation décroît plus vite que le son : l'attaque est brillante,
   * la queue devient pure.
   */
  bell(t: number, freq: number, gain = 0.12, decay = 1.2, ratio = 2, index = 1.4, rev = 0.4, pan = 0, bus?: AudioNode) {
    const { ctx } = this;
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    car.frequency.value = freq;
    mod.frequency.value = freq * ratio;
    this.env(modGain.gain, t, freq * index, 0.002, decay * 0.45);
    mod.connect(modGain);
    modGain.connect(car.frequency);
    const g = ctx.createGain();
    this.env(g.gain, t, gain, 0.003, decay);
    car.connect(g);
    this.route(g, rev, pan, bus);
    car.start(t);
    mod.start(t);
    car.stop(t + decay + 0.1);
    mod.stop(t + decay + 0.1);
  }

  /** Bouffée de bruit filtré (souffles, chocs, crépitements). */
  noise(t: number, o: NoiseOpts, bus?: AudioNode) {
    const { ctx } = this;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = o.filter ?? 'bandpass';
    f.frequency.setValueAtTime(o.freq, t);
    f.Q.value = o.q ?? 1;
    if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, t + o.dur);
    const g = ctx.createGain();
    const attack = o.attack ?? 0.003;
    this.env(g.gain, t, o.gain, attack, Math.max(0.01, o.dur - attack));
    src.connect(f);
    f.connect(g);
    this.route(g, o.rev ?? 0.15, o.pan ?? 0, bus);
    const offset = this.rnd() * 1.5;
    src.start(t, offset, o.dur + 0.05);
  }

  /** « Toc » de bois : sinus grave à chute de hauteur très rapide + clic filtré. */
  private wood(t: number, freq: number, gain: number, pan = 0) {
    this.voice(t, { freq, glideTo: freq * 0.55, glideTime: 0.06, gain, decay: 0.11, rev: 0.12, pan });
    this.voice(t, { freq: freq * 2.76, gain: gain * 0.18, decay: 0.04, rev: 0.05, pan }); // partiel inharmonique de marimba
    this.noise(t, { dur: 0.025, gain: gain * 0.35, freq: 2400, q: 1.5, rev: 0.05, pan });
  }

  // ---------------------------------------------------------------------------
  // Le catalogue des sons du jeu
  // ---------------------------------------------------------------------------

  play(e: Sfx, t = this.ctx.currentTime + 0.01) {
    const r = this.rnd;
    switch (e.type) {
      case 'select': {
        // Deux notes montantes de la voix du camp, dans le registre de la pièce.
        const root = ROOT[e.player];
        const k = REG[e.piece];
        const ratio = e.player === 1 ? 2 : 3.5;
        this.bell(t, mtof(degree(root, k)), 0.09, 0.9, ratio, 1.1, 0.35);
        this.bell(t + 0.075, mtof(degree(root, k + 2)), 0.08, 1.3, ratio, 0.9, 0.45);
        break;
      }
      case 'deselect':
        this.bell(t, mtof(degree(ROOT[e.player], -1)), 0.045, 0.6, 2, 0.6, 0.3);
        break;
      case 'hover': {
        // Petit « tic » : plus aigu pour une destination proche, plus grave pour une lointaine.
        if (e.kind === 'attack') {
          this.voice(t, { freq: mtof(50), type: 'triangle', gain: 0.05, decay: 0.12, rev: 0.1, lowpass: 900 });
        } else {
          const free = Math.max(0, e.max - e.cost);
          this.voice(t, { freq: mtof(degree(74, free)), gain: 0.028, decay: 0.07, rev: 0.2 });
        }
        break;
      }
      case 'step':
        // Le relief s'entend : la hauteur du « toc » suit l'altitude de la case.
        this.wood(t, mtof(degree(55, e.height)), 0.16, (r() - 0.5) * 0.3);
        break;
      case 'lift':
        // Petit saut de marche : glissando vers le haut (montée) ou le bas (descente).
        this.voice(t, {
          freq: e.dh > 0 ? 330 : 620,
          glideTo: e.dh > 0 ? 330 + 140 * e.dh : 620 - 120 * -e.dh,
          glideTime: 0.12,
          gain: 0.04,
          decay: 0.14,
          rev: 0.2,
        });
        break;
      case 'diagonal':
        this.noise(t, { dur: 0.22, gain: 0.03, freq: 900, sweepTo: 2600, q: 2.5, attack: 0.08, rev: 0.3 });
        break;
      case 'leap':
        // Souffle qui monte puis retombe, comme un objet lancé en l'air.
        this.noise(t, { dur: 0.26, gain: 0.045, freq: 500, sweepTo: 3200, q: 3, attack: 0.15, rev: 0.35 });
        this.noise(t + 0.24, { dur: 0.24, gain: 0.03, freq: 3200, sweepTo: 700, q: 3, attack: 0.02, rev: 0.35 });
        this.voice(t + 0.05, { freq: mtof(74), glideTo: mtof(86), glideTime: 0.3, gain: 0.025, decay: 0.35, rev: 0.6 });
        break;
      case 'land':
        this.wood(t, mtof(degree(55, e.height)), 0.15);
        this.bell(t, mtof(degree(86, 0)), 0.035, 0.8, 3.5, 0.7, 0.6);
        break;
      case 'attack':
        // Coup sourd et rond : on frappe, mais sans violence.
        this.voice(t, { freq: 120, glideTo: 42, glideTime: 0.22, gain: 0.3, decay: 0.38, rev: 0.15 });
        this.noise(t, { dur: 0.14, gain: 0.12, filter: 'lowpass', freq: 900, rev: 0.15 });
        this.voice(t + 0.005, { freq: mtof(degree(50, 0)), type: 'triangle', gain: 0.07, decay: 0.5, rev: 0.4, lowpass: 1200 });
        break;
      case 'shatter': {
        // Éclats de cristal qui retombent : cloches FM inharmoniques en cascade descendante.
        const base = degree(ROOT[e.player] + 12, 4);
        for (let i = 0; i < 8; i++) {
          const note = degree(base, -i + Math.floor(r() * 2));
          this.bell(t + i * 0.055 + r() * 0.03, mtof(note), 0.055 * (1 - i / 10), 0.5 + r() * 0.4, 3.5, 2, 0.5, (r() - 0.5) * 0.9);
        }
        this.noise(t, { dur: 0.35, gain: 0.06, filter: 'highpass', freq: 3500, rev: 0.4 });
        // La chute sous le plateau : un souffle qui descend.
        this.noise(t + 0.25, { dur: 0.9, gain: 0.035, freq: 1800, sweepTo: 250, q: 1.2, attack: 0.2, rev: 0.5 });
        break;
      }
      case 'exit': {
        // Arpège montant dans la voix du camp, qui s'envole vers le score.
        const root = ROOT[e.player];
        const ratio = e.player === 1 ? 2 : 3.5;
        for (let i = 0; i < 5; i++) this.bell(t + i * 0.09, mtof(degree(root, REG[e.piece] + i)), 0.1, 1.4 + i * 0.2, ratio, 1.2, 0.5, -0.4 + i * 0.2);
        this.noise(t + 0.1, { dur: 0.7, gain: 0.03, filter: 'highpass', freq: 4000, sweepTo: 9000, attack: 0.3, rev: 0.6 });
        break;
      }
      case 'turn':
        // Changement de tour : une seule cloche, très douce, dans la voix du camp qui joue.
        this.bell(t, mtof(ROOT[e.player] - 12), 0.05, 1.6, e.player === 1 ? 2 : 3.5, 0.5, 0.6);
        break;
      case 'pass':
        this.voice(t, { freq: mtof(degree(ROOT[e.player], 2)), type: 'triangle', gain: 0.07, decay: 0.35, lowpass: 1400, rev: 0.4 });
        this.voice(t + 0.18, { freq: mtof(degree(ROOT[e.player], 0)), type: 'triangle', gain: 0.06, decay: 0.6, lowpass: 1100, rev: 0.5 });
        break;
      case 'thinking':
        this.bell(t, mtof(degree(81, 0)), 0.02, 0.9, 3.5, 0.4, 0.7);
        break;
      case 'tick':
        // Dernières secondes de pendule : tic de bois, plus aigu sous 5 s.
        this.wood(t, e.urgent ? 1320 : 990, 0.05);
        break;
      case 'ui':
        this.voice(t, { freq: 1400, gain: 0.025, decay: 0.035, rev: 0.05 });
        break;
      case 'undo':
        this.noise(t, { dur: 0.22, gain: 0.05, freq: 2600, sweepTo: 600, q: 2, attack: 0.04, rev: 0.25 });
        this.voice(t + 0.05, { freq: mtof(69), glideTo: mtof(62), glideTime: 0.15, gain: 0.035, decay: 0.25, rev: 0.3 });
        break;
      case 'end': {
        if (e.outcome === 'win') {
          // Accord de ré majeur ajouté (ré fa♯ la si ré mi) égrené, puis nappe qui gonfle.
          [50, 54, 57, 62, 66, 69, 71, 74].forEach((m, i) => this.bell(t + i * 0.11, mtof(m), 0.09, 2.6, 2, 1, 0.55, -0.6 + i * 0.17));
          this.pad(t + 0.3, [38, 45, 54, 57], 3.5, 0.03, this.out);
        } else if (e.outcome === 'lose') {
          // Descente apaisée en si (relatif mineur), sans dramatisation.
          [71, 66, 62, 59].forEach((m, i) => this.bell(t + i * 0.22, mtof(m), 0.07, 2.2, 2, 0.6, 0.6));
          this.pad(t + 0.4, [35, 42, 50], 3, 0.028, this.out);
        } else {
          // Nulle : accord suspendu (ni majeur ni mineur).
          [57, 62, 64, 69].forEach((m, i) => this.bell(t + i * 0.16, mtof(m), 0.07, 2.4, 2, 0.8, 0.6));
          this.pad(t + 0.3, [45, 50, 52], 3, 0.028, this.out);
        }
        break;
      }
    }
  }

  /** Nappe : triangles légèrement désaccordés, filtrés, à attaque et relâche lentes. */
  pad(t: number, notes: number[], dur: number, gain: number, bus: AudioNode = this.music) {
    const { ctx } = this;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700;
    f.Q.value = 0.4;
    const g = ctx.createGain();
    const fade = Math.min(3, dur / 2.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + fade);
    g.gain.setValueAtTime(gain, t + dur - fade);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    f.connect(g);
    this.route(g, 0.5, 0, bus);
    for (const m of notes)
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = mtof(m);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.1);
      }
  }

  /**
   * Ambiance (programmée par tranches, pour fonctionner en temps réel comme hors-ligne) :
   * une nappe qui change lentement d'accord (I – vi – IV – V sus, toujours pentatonique),
   * quelques notes de cloche éparses très lointaines, et un souffle de vent.
   */
  ambience(t0: number, t1: number, state: { chord: number }) {
    const CHORDS = [
      [38, 45, 54, 57], // ré
      [35, 42, 50, 54], // si m
      [31, 38, 47, 50], // sol
      [33, 40, 47, 52], // la sus
    ];
    const LEN = 9; // secondes par accord (les nappes se chevauchent de 3 s)
    for (let t = t0; t < t1; t += LEN) {
      this.pad(t, CHORDS[state.chord % CHORDS.length], LEN + 3, 0.011);
      state.chord++;
      // 1 à 2 notes de cloche lointaines par accord
      const n = 1 + Math.floor(this.rnd() * 2);
      for (let k = 0; k < n; k++) {
        const note = degree(74, Math.floor(this.rnd() * 8));
        this.bell(t + 1 + this.rnd() * (LEN - 2), mtof(note), 0.018, 3, 2, 0.5, 0.85, (this.rnd() - 0.5) * 1.2, this.music);
      }
      // Vent : bruit filtré dont la fréquence ondule lentement
      this.noise(t, { dur: LEN + 2, gain: 0.006, freq: 380 + this.rnd() * 200, sweepTo: 650 + this.rnd() * 400, q: 0.8, attack: 3, rev: 0.4 }, this.music);
    }
  }
}

// -----------------------------------------------------------------------------
// Moteur temps réel (navigateur)
// -----------------------------------------------------------------------------

interface SoundSettings {
  muted: boolean;
  volume: number; // 0..1
  ambience: boolean;
}

const STORAGE_KEY = 'altara.sound';

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private synth: Synth | null = null;
  private master: GainNode | null = null;
  private ambState = { chord: 0 };
  private ambUntil = 0;
  private timer = 0;
  private lastHover = 0;
  settings: SoundSettings = { muted: false, volume: 0.8, ambience: true };

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) Object.assign(this.settings, JSON.parse(raw));
    } catch {
      /* stockage indisponible : réglages par défaut */
    }
  }

  /**
   * Les navigateurs n'autorisent le son qu'après une action de l'utilisateur :
   * le contexte audio est créé (ou relancé) au premier clic ou à la première touche.
   */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.synth = new Synth(this.ctx, this.master, Date.now());
      this.applySettings();
      // Programmation de l'ambiance par tranches, quelques secondes à l'avance.
      this.timer = window.setInterval(() => this.scheduleAmbience(), 1500);
    }
    if (this.ctx.state === 'suspended' && !this.settings.muted) void this.ctx.resume();
  }

  private scheduleAmbience() {
    if (!this.ctx || !this.synth || !this.settings.ambience || this.settings.muted) return;
    const now = this.ctx.currentTime;
    if (this.ambUntil < now) this.ambUntil = now + 0.1;
    while (this.ambUntil < now + 12) {
      this.synth.ambience(this.ambUntil, this.ambUntil + 9, this.ambState);
      this.ambUntil += 9;
    }
  }

  /** Joue un son, éventuellement avec un léger différé (en secondes). */
  play(e: Sfx, delay = 0) {
    if (!this.synth || !this.ctx || this.settings.muted) return;
    if (e.type === 'hover') {
      // Pas plus d'un « tic » toutes les 45 ms quand la souris balaie le plateau.
      const now = performance.now();
      if (now - this.lastHover < 45) return;
      this.lastHover = now;
    }
    this.synth.play(e, this.ctx.currentTime + 0.01 + delay);
  }

  set(patch: Partial<SoundSettings>) {
    Object.assign(this.settings, patch);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      /* sans importance */
    }
    this.applySettings();
  }

  private applySettings() {
    if (!this.ctx || !this.master || !this.synth) return;
    const t = this.ctx.currentTime;
    const { muted, volume, ambience } = this.settings;
    this.master.gain.setTargetAtTime(muted ? 0 : volume, t, 0.08);
    this.synth.music.gain.setTargetAtTime(ambience ? 1 : 0, t, 0.6);
    if (ambience && !muted) this.scheduleAmbience();
    // En sourdine, on suspend le contexte : aucun calcul audio inutile.
    if (muted) window.setTimeout(() => this.settings.muted && this.ctx?.suspend(), 300);
    else if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  dispose() {
    clearInterval(this.timer);
    void this.ctx?.close();
  }
}

// -----------------------------------------------------------------------------
// Démo hors-ligne (vérification des niveaux, et écoute sans jouer)
// -----------------------------------------------------------------------------

export const DEMO_SEQUENCE: { label: string; at: number; e: Sfx }[] = [
  { label: 'Sélection Explorateur (Corail)', at: 0.3, e: { type: 'select', piece: 'explorer', player: 1 } },
  { label: 'Sélection Sentinelle (Corail)', at: 1.5, e: { type: 'select', piece: 'sentinel', player: 1 } },
  { label: 'Sélection Avant-garde (Lagon)', at: 2.7, e: { type: 'select', piece: 'vanguard', player: 2 } },
  { label: 'Survol de destinations', at: 3.9, e: { type: 'hover', kind: 'move', cost: 1, max: 5 } },
  { label: '', at: 4.05, e: { type: 'hover', kind: 'move', cost: 3, max: 5 } },
  { label: '', at: 4.2, e: { type: 'hover', kind: 'move', cost: 5, max: 5 } },
  { label: '', at: 4.4, e: { type: 'hover', kind: 'attack', cost: 3, max: 5 } },
  { label: 'Désélection', at: 4.9, e: { type: 'deselect', player: 1 } },
  { label: 'Marche sur le relief (h 1 → 2 → 4 → 3)', at: 5.8, e: { type: 'step', height: 1, dh: 0, index: 1 } },
  { label: '', at: 6.0, e: { type: 'lift', dh: 1 } },
  { label: '', at: 6.25, e: { type: 'step', height: 2, dh: 1, index: 2 } },
  { label: '', at: 6.3, e: { type: 'lift', dh: 2 } },
  { label: '', at: 6.67, e: { type: 'step', height: 4, dh: 2, index: 3 } },
  { label: '', at: 6.7, e: { type: 'lift', dh: -1 } },
  { label: '', at: 6.97, e: { type: 'step', height: 3, dh: -1, index: 4 } },
  { label: 'Pas diagonal', at: 7.9, e: { type: 'diagonal' } },
  { label: '', at: 8.2, e: { type: 'land', height: 2 } },
  { label: 'Bond', at: 9.1, e: { type: 'leap' } },
  { label: '', at: 9.58, e: { type: 'land', height: 3 } },
  { label: 'Attaque + capture', at: 10.8, e: { type: 'attack' } },
  { label: '', at: 10.92, e: { type: 'shatter', piece: 'vanguard', player: 2 } },
  { label: 'Sortie (Corail)', at: 13.0, e: { type: 'exit', player: 1, piece: 'vanguard' } },
  { label: 'Changement de tour (Lagon puis Corail)', at: 15.2, e: { type: 'turn', player: 2 } },
  { label: '', at: 16.4, e: { type: 'turn', player: 1 } },
  { label: "L'IA réfléchit", at: 17.6, e: { type: 'thinking' } },
  { label: 'Passe son tour', at: 18.6, e: { type: 'pass', player: 2 } },
  { label: 'Bouton / Annuler', at: 19.8, e: { type: 'ui' } },
  { label: '', at: 20.2, e: { type: 'undo' } },
  { label: 'Victoire', at: 21.2, e: { type: 'end', outcome: 'win' } },
  { label: 'Défaite', at: 25.6, e: { type: 'end', outcome: 'lose' } },
  { label: 'Nulle', at: 29.6, e: { type: 'end', outcome: 'draw' } },
];

/**
 * Rend la démo dans un OfflineAudioContext : tous les effets, puis (si `ambienceSeconds`)
 * un passage d'ambiance seule. Renvoie le tampon audio (stéréo).
 */
export async function renderDemo(ambienceSeconds = 20, sampleRate = 44100): Promise<{ buffer: AudioBuffer; marks: { label: string; at: number }[] }> {
  const sfxEnd = 33.5;
  const total = sfxEnd + ambienceSeconds + (ambienceSeconds ? 3 : 0);
  const ctx = new OfflineAudioContext(2, Math.ceil(total * sampleRate), sampleRate);
  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);
  const synth = new Synth(ctx, master, 7);
  for (const s of DEMO_SEQUENCE) synth.play(s.e, s.at);
  const marks = DEMO_SEQUENCE.filter((s) => s.label).map((s) => ({ label: s.label, at: s.at }));
  if (ambienceSeconds) {
    synth.ambience(sfxEnd, sfxEnd + ambienceSeconds, { chord: 0 });
    marks.push({ label: 'Ambiance', at: sfxEnd });
  }
  return { buffer: await ctx.startRendering(), marks };
}

/** Encode un AudioBuffer en WAV 16 bits (pour télécharger la démo). */
export function toWav(buf: AudioBuffer): ArrayBuffer {
  const ch = buf.numberOfChannels;
  const len = buf.length;
  const out = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  out.setUint32(4, 36 + len * ch * 2, true);
  str(8, 'WAVEfmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, ch, true);
  out.setUint32(24, buf.sampleRate, true);
  out.setUint32(28, buf.sampleRate * ch * 2, true);
  out.setUint16(32, ch * 2, true);
  out.setUint16(34, 16, true);
  str(36, 'data');
  out.setUint32(40, len * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++)
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  return out.buffer;
}
