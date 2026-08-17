import { useEffect, useState } from 'react';

/** Tiny hash router: '#/settings?x=1' -> { path: '/settings', params }. */
export interface HashRoute {
  path: string;
  params: URLSearchParams;
}

function parse(): HashRoute {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [path = '/', query = ''] = raw.split('?');
  return { path, params: new URLSearchParams(query) };
}

export function useHashRoute(): HashRoute {
  const [route, setRoute] = useState<HashRoute>(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(path: string): void {
  window.location.hash = path;
}
