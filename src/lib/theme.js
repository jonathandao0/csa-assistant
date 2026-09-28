import { useEffect, useState } from 'react';

// Light/dark preference. Kept in localStorage rather than IndexedDB because it has to be
// read synchronously before the first paint (no flash of the wrong theme), and it's a
// per-device convenience rather than data worth backing up.
const KEY = 'csa-theme';
export const THEMES = [
  ['system', 'Match device'],
  ['light', 'Light'],
  ['dark', 'Dark'],
];

export function getThemePref() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

const darkQuery = () => window.matchMedia?.('(prefers-color-scheme: dark)');

/** The theme actually showing, resolving "system" against the device setting. */
export function effectiveTheme(pref = getThemePref()) {
  if (pref !== 'system') return pref;
  return darkQuery()?.matches ? 'dark' : 'light';
}

export function applyTheme(pref = getThemePref()) {
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', effectiveTheme(pref) === 'dark' ? '#13304F' : '#0B5CAD');
}

export function setThemePref(pref) {
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // Storage blocked; the choice still applies for this session.
  }
  applyTheme(pref);
  window.dispatchEvent(new CustomEvent('csa-theme', { detail: pref }));
}

/** Current preference plus the resolved theme, updating when either changes. */
export function useTheme() {
  const [pref, setPref] = useState(getThemePref);
  const [, force] = useState(0);
  useEffect(() => {
    const onPref = (e) => setPref(e.detail);
    const mq = darkQuery();
    const onSystem = () => {
      applyTheme();
      force((n) => n + 1);
    };
    window.addEventListener('csa-theme', onPref);
    mq?.addEventListener?.('change', onSystem);
    return () => {
      window.removeEventListener('csa-theme', onPref);
      mq?.removeEventListener?.('change', onSystem);
    };
  }, []);
  return { pref, theme: effectiveTheme(pref), setPref: setThemePref };
}
