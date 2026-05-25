import { createContext, useContext, useMemo } from "react";

import { createApiClient, type ApiClient } from "./client";

const ApiClientContext = createContext<ApiClient>(createApiClient());

export function ApiClientProvider({
  baseUrl,
  children,
}: {
  baseUrl?: string;
  children: React.ReactNode;
}) {
  const client = useMemo(() => createApiClient(baseUrl), [baseUrl]);

  return (
    <ApiClientContext.Provider value={client}>{children}</ApiClientContext.Provider>
  );
}

export function useApiClient() {
  return useContext(ApiClientContext);
}
