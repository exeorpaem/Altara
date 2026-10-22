// Fiche de règles consultable en jeu. Le contenu est GÉNÉRÉ à partir de RULES et PIECES
// (src/engine/rules.ts) : changer une valeur de règle met la fiche à jour sans rien retoucher ici.
// Le panneau est une fenêtre modale légère : elle ne met ni la pendule ni l'IA en pause.
import { PIECES, PIECE_TYPES, RULES, type PieceType } from '../engine/rules';

/** Polygone régulier (socle à `n` côtés) en SVG inline, pointe vers le haut. */
function polygonSvg(n: number, color: string): string {
  const pts = Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return `${(16 + 13 * Math.cos(a)).toFixed(1)},${(16 + 13 * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
  return `<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><polygon points="${pts}" fill="${color}" stroke="#4a4a5a" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}

/** Sommet à `n` pointes : n petits triangles alignés. */
function spikesSvg(n: number): string {
  const w = 44 / n;
  const tri = Array.from({ length: n }, (_, i) => {
    const x = 2 + i * w;
    return `<polygon points="${x + 1},28 ${x + w / 2},6 ${x + w - 1},28" fill="#f2c94c" stroke="#4a4a5a" stroke-width="1.2" stroke-linejoin="round"/>`;
  }).join('');
  return `<svg viewBox="0 0 48 32" width="44" height="30" aria-hidden="true">${tri}</svg>`;
}

const COLORS: Record<PieceType, string> = { explorer: '#cfeaec', vanguard: '#fbd5cf', sentinel: '#e3d8f3' };

function pieceCards(): string {
  return PIECE_TYPES.map((t) => {
    const p = PIECES[t];
    return `<div class="rp-card"><div class="rp-icons">${polygonSvg(p.movement, COLORS[t])}${spikesSvg(p.strength)}</div>
      <b>${p.name}</b><span>Mouvement ${p.movement} · Force ${p.strength}</span><small>${p.ability}</small></div>`;
  }).join('');
}

interface Section { title: string; html: string; open?: boolean }

function sections(): Section[] {
  const { combat, end, exitCost, maxTurns, pieceBudget } = RULES;
  const P = PIECES;
  const e = P.explorer, v = P.vanguard, s = P.sentinel;
  return [
    {
      title: 'But du jeu',
      open: true,
      html: `<p>Chaque joueur dirige 6 pièces posées sur un plateau en relief de ${RULES.board.size}×${RULES.board.size} cases.
        Il faut <b>faire sortir ses pièces par le bord adverse</b> : Corail (J1) part du bas et sort par le haut,
        Lagon (J2) fait l'inverse. Corail commence.</p>
        <p>On peut aussi <b>capturer</b> les pièces adverses pour les empêcher de passer.</p>`,
    },
    {
      title: 'Les pièces',
      html: `<div class="rp-cards">${pieceCards()}</div>
        <p>Chaque pièce a un <b>socle à M côtés</b> : M est son <b>Mouvement</b> (budget de déplacement par tour).
        Son <b>sommet à N pointes</b> donne sa <b>Force</b> N, utilisée au combat et rapportée en points quand elle sort.</p>
        <p>Mouvement + Force font toujours ${pieceBudget} : une pièce rapide est fragile, une pièce solide est lente.
        Les deux camps ont chacun 2 ${e.name}s, 2 ${v.name}s et 2 ${s.name}s.</p>`,
    },
    {
      title: 'Déplacement',
      html: `<p>À chaque tour, on déplace <b>une</b> pièce, en <b>ligne droite ou en escalier</b> de cases voisines
        (haut, bas, gauche, droite — pas en diagonale).</p>
        <ul>
          <li>Un pas coûte <b>1</b> sur terrain plat, et <b>|différence de hauteur| + 1</b> si le niveau change
            (monter ou descendre de 2 coûte donc 3).</li>
          <li>Le coût total du trajet ne peut pas dépasser le Mouvement de la pièce.</li>
          <li>On ne traverse aucune pièce (amie ou ennemie) et on ne finit pas sur sa case de départ.</li>
          <li><b>${e.name}</b> uniquement : à la place d'un trajet, un <b>pas en diagonale</b> ou un <b>bond de 2 cases</b>
            en ligne. Le relief est ignoré, mais la case d'arrivée (et, pour le bond, la case du milieu) doit être vide.
            Ces coups spéciaux ne permettent <b>ni d'attaquer, ni de sortir</b>.</li>
        </ul>`,
    },
    {
      title: 'Sortie',
      html: `<p>Une pièce posée sur la <b>dernière rangée</b> (le bord adverse) peut <b>sortir</b> du plateau
        si il lui reste au moins ${exitCost} point de Mouvement (la sortie coûte ${exitCost}).
        ${RULES.movement.exitInSameMove ? 'Elle peut même rejoindre la rangée et sortir dans le même tour.' : ''}</p>
        <p>En sortant, la pièce <b>rapporte sa Force en points</b> (${e.strength}, ${v.strength} ou ${s.strength}).
        Une pièce sortie ne revient pas.</p>`,
    },
    {
      title: 'Combat',
      html: `<p>Pour attaquer, la pièce suit un trajet normal jusqu'à une case voisine de l'ennemi, puis <b>entre sur sa case</b>
        (dénivelé compris). Le coût total ne doit pas dépasser son Mouvement.</p>
        <p>L'attaque réussit si <b>attaque ≥ défense</b> (égalité : l'attaquant gagne). Le défenseur est retiré
        du plateau et l'attaquant prend sa place.</p>
        <div class="rp-formula"><b>Attaque</b> = Force
          <br>+ ${combat.height} si la case d'appui est plus haute que la cible, −${combat.height} si elle est plus basse
          <br>+ la Force de chaque <b>autre allié</b> voisin de la cible
          <br>+ ${combat.charge} de <b>charge</b> (${v.name} seulement)</div>
        <div class="rp-formula"><b>Défense</b> = Force du défenseur
          <br>+ ${combat.reinforcement} par <b>renfort</b> : pièce alliée du défenseur voisine de lui</div>
        <ul>
          <li>La <b>case d'appui</b> est la case voisine de la cible d'où l'attaquant entre. S'il y en a plusieurs,
            le jeu choisit <b>automatiquement</b> celle qui donne la meilleure attaque (à égalité, la moins chère).</li>
          <li>La hauteur des alliés et des renforts ne compte pas.</li>
          <li><b>Charge de l'${v.name}</b> : +${combat.charge} si son trajet passant par la case d'appui coûte
            <b>exactement ${combat.chargeCost}</b>.</li>
          <li>Un anneau gris signale une attaque impossible ; survole-le pour savoir pourquoi.</li>
        </ul>`,
    },
    {
      title: 'Fin de partie',
      html: `<ul>
          <li><b>Sentinelle</b> : ${end.sentinelExitWins ? 'si elle sort, son camp gagne immédiatement' : 'sa sortie est ordinaire'}
            ${end.sentinelMustExitFirst ? '— <b>seulement si c\'est la 1re pièce sortie de la partie</b> (tous camps confondus). Sinon, c\'est une sortie ordinaire.' : '.'}</li>
          <li>Sinon, le <b>premier joueur à faire sortir ${end.exitsToWin} pièces</b> gagne (une pièce capturée ne compte pas).</li>
          ${end.noPiecesLoses ? `<li><b>Plus aucune pièce sur le plateau</b> :
            si la dernière a été <b>capturée</b>, tu perds. Si elle est <b>sortie</b>, tu gagnes quand l'adversaire ne peut plus
            t'égaler (son score + la Force de ses pièces restantes) ; c'est <b>nul</b> s'il peut au mieux égaler ; sinon tu perds.</li>` : ''}
          <li><b>Limite de ${maxTurns} coups</b> (passes comprises) : le meilleur score en points gagne. Si personne n'a marqué,
            la pièce la plus avancée, puis la plus grande Force, sinon partie nulle.</li>
          <li><b>Pendule</b> : le temps de réflexion est décompté pour chaque joueur ; à 0, on perd. Elle ne tourne pas
            pendant les animations. Cadence réglable ou désactivable dans « Partie &amp; décor ».</li>
          <li>Sans coup légal, on passe son tour (un message l'indique).</li>
        </ul>`,
    },
    {
      title: "Commandes de l'interface",
      html: `<ul>
          <li><b>Clic</b> sur une de tes pièces pour la sélectionner, puis sur une case marquée pour jouer :
            point = déplacement (plus pâle = plus coûteux), losange = coup spécial, anneau = attaque, flèche = sortie.</li>
          <li><b>Clic droit</b> ou <kbd>Échap</kbd> : annuler la sélection.</li>
          <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> ou bouton « Annuler le coup » : revenir en arrière.</li>
          <li><b>Pièce adverse</b> : un clic montre ses coups possibles (anneaux creux), sans jouer.</li>
          <li><kbd>M</kbd> : couper / rétablir le son. <kbd>R</kbd> : ouvrir / fermer cette fiche.</li>
          <li>Glisser pour tourner la vue, molette ou pincement pour zoomer.</li>
        </ul>`,
    },
  ];
}

/** Monte le bouton « Règles » (déjà présent dans la page) et le panneau. */
export function setupRulesPanel(button: HTMLElement): void {
  const overlay = document.createElement('div');
  overlay.className = 'rp-overlay';
  overlay.hidden = true;
  const body = sections()
    .map((sec) => `<details class="rp-sec"${sec.open ? ' open' : ''}><summary>${sec.title}</summary><div class="rp-body">${sec.html}</div></details>`)
    .join('');
  overlay.innerHTML = `<div class="rp-panel" role="dialog" aria-modal="true" aria-labelledby="rp-title" tabindex="-1">
      <header><h2 id="rp-title">Règles d'Altara</h2>
        <button type="button" class="btn btn-icon rp-close" aria-label="Fermer les règles">×</button></header>
      <div class="rp-scroll">${body}</div></div>`;
  document.body.appendChild(overlay);
  const panel = overlay.querySelector<HTMLElement>('.rp-panel')!;
  let lastFocus: HTMLElement | null = null;

  const isOpen = () => !overlay.hidden;
  function open() {
    lastFocus = document.activeElement as HTMLElement | null;
    overlay.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    panel.focus();
  }
  function close() {
    overlay.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    // Retour du focus à l'élément qui avait ouvert la fiche (si encore dans la page).
    (lastFocus && lastFocus !== document.body && document.contains(lastFocus) ? lastFocus : button).focus();
  }
  const toggle = () => (isOpen() ? close() : open());

  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', toggle);
  overlay.querySelector('.rp-close')!.addEventListener('click', close);
  // Clic hors du panneau (sur le voile) = fermeture.
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) close();
  });

  window.addEventListener(
    'keydown',
    (ev) => {
      const t = ev.target as HTMLElement | null;
      if (ev.key === 'Escape' && isOpen()) {
        // En phase de capture : on empêche l'Échap de désélectionner une pièce en même temps.
        ev.stopImmediatePropagation();
        ev.preventDefault();
        close();
        return;
      }
      const typing = !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
      if (ev.key.toLowerCase() === 'r' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !typing) {
        ev.preventDefault();
        toggle();
      }
      // Garde le Tab dans le panneau tant qu'il est ouvert (dialogue modal).
      if (ev.key === 'Tab' && isOpen()) {
        const f = [...panel.querySelectorAll<HTMLElement>('button, summary')];
        const first = f[0], last = f[f.length - 1];
        if (!panel.contains(document.activeElement) || (ev.shiftKey && document.activeElement === first)) {
          ev.preventDefault();
          (ev.shiftKey ? last : first).focus();
        } else if (!ev.shiftKey && document.activeElement === last) {
          ev.preventDefault();
          first.focus();
        }
      }
    },
    true,
  );
}
