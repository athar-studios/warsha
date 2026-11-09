// eslint-disable-next-line import/no-unresolved
import { useT } from '@warsha/i18n/v3';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { ROUTES, type RouteArea, type RouteDefinition } from './routes';

export interface RouteMatch {
  route: RouteDefinition;
  params: Record<string, string>;
  pathname: string;
}

export function normalizePath(hashOrPath: string): string {
  let cleaned = hashOrPath.trim();
  if (cleaned.startsWith('#')) {
    cleaned = cleaned.slice(1);
  }
  if (!cleaned.startsWith('/')) {
    cleaned = '/' + cleaned;
  }
  // Strip query string if present in hash
  const qIdx = cleaned.indexOf('?');
  if (qIdx >= 0) {
    cleaned = cleaned.slice(0, qIdx);
  }
  // Remove trailing slash if not root
  if (cleaned.length > 1 && cleaned.endsWith('/')) {
    cleaned = cleaned.slice(0, -1);
  }
  return cleaned || '/';
}

export function matchRoute(pathname: string, routes: readonly RouteDefinition[] = ROUTES): RouteMatch | null {
  const norm = normalizePath(pathname);
  for (const r of routes) {
    const match = norm.match(r.regex);
    if (match) {
      const params: Record<string, string> = {};
      for (let i = 0; i < r.paramNames.length; i++) {
        params[r.paramNames[i]] = decodeURIComponent(match[i + 1] ?? '');
      }
      return {
        route: r,
        params,
        pathname: norm,
      };
    }
  }
  return null;
}

interface RouterContextValue {
  pathname: string;
  params: Record<string, string>;
  currentRoute: RouteDefinition | null;
  area: RouteArea | null;
  navigate: (to: string) => void;
}

const RouterContext = createContext<RouterContextValue | null>(null);

export interface RouterProviderProps {
  initialPath?: string;
  children: React.ReactNode;
}

export function RouterProvider({ initialPath, children }: RouterProviderProps): React.ReactElement {
  const [pathname, setPathname] = useState<string>(() => {
    if (initialPath) return normalizePath(initialPath);
    if (typeof window !== 'undefined' && window.location.hash) {
      return normalizePath(window.location.hash);
    }
    return '/';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onHashChange = (): void => {
      setPathname(normalizePath(window.location.hash));
    };

    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  const navigate = (to: string): void => {
    const norm = normalizePath(to);
    setPathname(norm);
    if (typeof window !== 'undefined') {
      window.location.hash = `#${norm}`;
    }
  };

  const match = useMemo(() => matchRoute(pathname), [pathname]);

  const value = useMemo<RouterContextValue>(() => {
    return {
      pathname,
      params: match ? match.params : {},
      currentRoute: match ? match.route : null,
      area: match ? match.route.area : null,
      navigate,
    };
  }, [pathname, match]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterContextValue {
  const ctx = useContext(RouterContext);
  if (!ctx) {
    throw new Error('useRouter must be used within a RouterProvider');
  }
  return ctx;
}

export function useRoute(): {
  pathname: string;
  params: Record<string, string>;
  route: RouteDefinition | null;
  area: RouteArea | null;
} {
  const { pathname, params, currentRoute, area } = useRouter();
  return { pathname, params, route: currentRoute, area };
}

export function useNavigate(): (to: string) => void {
  const { navigate } = useRouter();
  return navigate;
}

export function RouteOutlet(): React.ReactElement {
  const { currentRoute } = useRouter();
  const t = useT();
  if (!currentRoute) {
    return <div>{t('common.not_found')}</div>;
  }
  const Component = currentRoute.component;
  return <Component />;
}
