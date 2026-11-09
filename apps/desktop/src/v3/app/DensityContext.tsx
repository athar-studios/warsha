import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type AppMode = 'simple' | 'advanced';
export type Density = 'comfortable' | 'compact';

interface DensityContextValue {
  mode: AppMode;
  density: Density;
  setMode: (mode: AppMode) => void;
  setDensity: (density: Density) => void;
}

const DensityContext = createContext<DensityContextValue>({
  mode: 'simple',
  density: 'comfortable',
  setMode: () => {},
  setDensity: () => {},
});

export const APP_MODE_STORAGE_KEY = 'warsha.app_mode';

export function readStoredAppMode(): AppMode {
  if (typeof window === 'undefined') return 'simple';
  try {
    const val = window.localStorage.getItem(APP_MODE_STORAGE_KEY);
    if (val === 'simple' || val === 'advanced') return val;
  } catch {
    // Ignore storage errors
  }
  return 'simple';
}

export interface DensityProviderProps {
  initialMode?: AppMode;
  initialDensity?: Density;
  children: React.ReactNode;
}

export function DensityProvider({
  initialMode,
  initialDensity,
  children,
}: DensityProviderProps): React.ReactElement {
  const [mode, setModeState] = useState<AppMode>(() => initialMode ?? readStoredAppMode());
  const [density, setDensityState] = useState<Density>(() => {
    if (initialDensity) return initialDensity;
    return mode === 'advanced' ? 'compact' : 'comfortable';
  });

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-mode', mode);
      document.documentElement.setAttribute('data-density', density);
    }
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(APP_MODE_STORAGE_KEY, mode);
      } catch {
        // Ignore storage errors
      }
    }
  }, [mode, density]);

  const setMode = (nextMode: AppMode): void => {
    setModeState(nextMode);
    setDensityState(nextMode === 'advanced' ? 'compact' : 'comfortable');
  };

  const value = useMemo<DensityContextValue>(
    () => ({
      mode,
      density,
      setMode,
      setDensity: setDensityState,
    }),
    [mode, density]
  );

  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>;
}

export function useDensity(): DensityContextValue {
  return useContext(DensityContext);
}
