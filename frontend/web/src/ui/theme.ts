export type Theme = 'light' | 'dark' | 'system';
export function currentTheme(): Theme {
  try { const value = localStorage.getItem('careeros.theme'); return value === 'light' || value === 'dark' ? value : 'system'; } catch { return 'system'; }
}
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
}
export function saveTheme(theme: Theme) {
  try { localStorage.setItem('careeros.theme', theme); } catch { /* Theme remains usable without storage. */ }
  applyTheme(theme);
}
export function initializeTheme() {
  applyTheme(currentTheme());
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (currentTheme() === 'system') applyTheme('system'); });
}
