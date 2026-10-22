// Thème de l'interface : Auto (préférence du système), Clair ou Sombre.
// Le choix est mémorisé (localStorage, avec try/catch) et posé sur <html data-theme="light|dark">.
// En mode Auto, l'attribut est absent et le CSS suit prefers-color-scheme.
export type ThemeChoice = 'auto' | 'light' | 'dark';

const KEY = 'altara.theme';
const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

export function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* stockage indisponible */
  }
  return 'auto';
}

/** Le thème effectivement affiché est-il sombre ? */
export function isDark(choice: ThemeChoice = readTheme()): boolean {
  return choice === 'dark' || (choice === 'auto' && !!mq?.matches);
}

/**
 * Applique le thème au document ; `onChange` est rappelé à l'initialisation, à chaque choix et
 * quand le système change de préférence (en mode Auto). Les `<select class="theme-select">` sont liés.
 */
export function setupTheme(onChange: (dark: boolean) => void): void {
  const selects = [...document.querySelectorAll<HTMLSelectElement>('.theme-select')];
  const apply = (choice: ThemeChoice) => {
    const root = document.documentElement;
    if (choice === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', choice);
    for (const s of selects) s.value = choice;
    onChange(isDark(choice));
  };
  for (const s of selects) {
    s.onchange = () => {
      const choice = s.value as ThemeChoice;
      try {
        localStorage.setItem(KEY, choice);
      } catch {
        /* sans importance */
      }
      apply(choice);
    };
  }
  mq?.addEventListener('change', () => readTheme() === 'auto' && apply('auto'));
  apply(readTheme());
}
