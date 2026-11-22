import React, { createContext, useContext, useMemo, useState } from 'react';

interface DataReadyContextValue {
  isReady: boolean;
  setReady: (ready: boolean) => void;
}

const DataReadyContext = createContext<DataReadyContextValue>({
  isReady: true,
  setReady: () => {},
});

export function DataReadyProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [isReady, setReady] = useState(true);

  const value = useMemo(() => ({ isReady, setReady }), [isReady]);

  return <DataReadyContext.Provider value={value}>{children}</DataReadyContext.Provider>;
}

export function useDataReady(): DataReadyContextValue {
  return useContext(DataReadyContext);
}
