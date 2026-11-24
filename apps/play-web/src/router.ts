// The address is the part after #: #/ (title), #/saves, #/new, #/play/<save id>, #/login and, in
// development and screenshot builds, #/gallery/<section>. Panels never enter the address.
import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'title' }
  | { name: 'saves' }
  | { name: 'new' }
  | { name: 'play'; id: string }
  | { name: 'login' }
  | { name: 'gallery'; section?: string }
  | { name: 'missing'; path: string };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').split('?')[0] ?? '';
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const [head, arg, ...rest] = parts;
  if (!head) return { name: 'title' };
  if (head === 'saves' && !arg) return { name: 'saves' };
  if (head === 'new' && !arg) return { name: 'new' };
  if (head === 'login' && !arg) return { name: 'login' };
  if (head === 'play' && arg && rest.length === 0) return { name: 'play', id: arg };
  if (head === 'gallery' && rest.length === 0) return arg ? { name: 'gallery', section: arg } : { name: 'gallery' };
  return { name: 'missing', path };
}

export function routePath(route: Route): string {
  switch (route.name) {
    case 'title':
      return '#/';
    case 'play':
      return `#/play/${encodeURIComponent(route.id)}`;
    case 'gallery':
      return route.section ? `#/gallery/${route.section}` : '#/gallery';
    case 'missing':
      return `#${route.path}`;
    default:
      return `#/${route.name}`;
  }
}

/** Goes to a route, keeping any ?parameters that stand inside the hash (fixture, light …). */
export function navigate(route: Route, { replace = false } = {}): void {
  const query = location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?')) : '';
  const next = routePath(route) + query;
  if (replace) history.replaceState(history.state, '', next);
  else location.hash = next;
  if (replace) dispatchEvent(new HashChangeEvent('hashchange'));
}

function subscribe(notify: () => void) {
  addEventListener('hashchange', notify);
  return () => removeEventListener('hashchange', notify);
}

/** The current route, re-rendering when the hash changes. */
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash, () => '');
  return parseRoute(hash);
}
