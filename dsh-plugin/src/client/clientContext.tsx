/**
 * HostClient 注入面：PluginDetailPage 顶层装配（真实 dsh 桥的 createHostClient 或测试
 * 的 mockHost），子组件经 useClient() 取——免逐层透传。
 */
import { createContext, useContext, type ReactNode } from "react";
import type { HostClient } from "./rpc";

const ClientContext = createContext<HostClient | null>(null);

export function ClientProvider({ client, children }: { client: HostClient; children: ReactNode }): React.JSX.Element {
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}

export function useClient(): HostClient {
  const client = useContext(ClientContext);
  if (client === null) {
    throw new Error("useClient 必须在 ClientProvider 内使用");
  }
  return client;
}
