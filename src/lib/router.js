import { useEffect, useState } from 'react';

// Hash-based routing works on GitHub Pages without server rewrites.
export function useRoute() {
  const read = () => (location.hash || '#/').slice(1).split('/').filter(Boolean).map(decodeURIComponent);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const onChange = () => {
      setParts(read());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return parts;
}

export function nav(path) {
  location.hash = path;
}

export function replace(path) {
  history.replaceState(null, '', `#${path}`);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

let inAppNavigations = 0;
window.addEventListener('hashchange', () => {
  inAppNavigations += 1;
});

/** Goes back if we navigated here within the app, otherwise to a sensible parent. */
export function goBack(fallback) {
  if (inAppNavigations > 0) history.back();
  else nav(fallback);
}
