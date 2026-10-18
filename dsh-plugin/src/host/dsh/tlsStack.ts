/**
 * TLS 栈功能性探测（compatibility.md A3 的机检面）：dsh-ssh 流安全写死
 * TLS 1.2 + PSK-AES256-GCM-SHA384；Electron 内嵌 Node（BoringSSL）的
 * setCipherList 不认识 PSK 族套件名（NO_CIPHER_MATCH），系统 Node（OpenSSL）可用。
 * 判据 = 功能性探测（try/catch 建安全上下文），比 process.versions/electron
 * 启发式稳（不依赖宿主自报）。探测不可用 → sshScopeHost 路由 broker 传输
 * （brokerScope.ts：家族装配外包给系统 Node 子进程）。
 */
import { createSecureContext } from "node:tls";

/** 探测套件 = dsh-ssh stream-security 写死的套件名（同源单点——上游升级换套件时同步改） */
export const PSK_PROBE_CIPHER = "PSK-AES256-GCM-SHA384";

/** 安全上下文工厂面（测试注入 BoringSSL 形态用） */
export type SecureContextFactory = typeof createSecureContext;

/** 当前进程 TLS 栈是否支持 dsh-ssh 的 TLS-PSK 流安全 */
export function tlsPskAvailable(create: SecureContextFactory = createSecureContext): boolean {
  try {
    create({ ciphers: PSK_PROBE_CIPHER });
    return true;
  } catch {
    return false;
  }
}
