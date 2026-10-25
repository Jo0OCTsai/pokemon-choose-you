/**
 * broker 桥协议（compatibility.md A3 的过渡通道）：BoringSSL 宿主（dsh 桌面）里
 * dsh-ssh 家族装配外包给系统 Node 子进程（brokerScope.ts 派生、broker/brokerMain
 * 服务），两侧经 stdio JSON 行通信。协议纯请求-响应（id 关联）——终端输出不回流
 * （交互面 = spawnTerminal/writeTerminal/terminateTerminal 三原语），无流事件。
 *
 * 连接语义：op "connect" 携带部署五元组（= dsh-ssh Config + deploymentId/workdir），
 * broker 侧裸 cordis 双 label isolate 装载家族（spike 修正 A/B 模式，端到端已验：
 * 连真容器 252ms 建连 + 远端执行）；stdin EOF = 宿主侧消亡 → broker 尽力 dispose 退出。
 */

/** 部署连接五元组（dsh-ssh Config 同形 + 部署标识/工作目录） */
export interface BrokerConnectConfig {
  host: string;
  node: string;
  helper: string;
  helperHash: string;
  workspace: string;
}

/** host → broker 请求（六类原语；spawn 结果由 broker 侧测量 durationMs） */
export type HostRequest =
  | { id: number; op: "connect"; config: BrokerConnectConfig; deploymentId: string; workdir: string }
  | { id: number; op: "spawn"; argv: string[]; cwd: string; timeoutMs?: number; stdin?: string }
  | { id: number; op: "spawnTerminal"; argv: string[]; cwd?: string }
  | { id: number; op: "writeTerminal"; sessionId: string; data: string }
  | { id: number; op: "terminateTerminal"; sessionId: string }
  | { id: number; op: "disconnect" };

/** broker spawn 应答载荷（SshSpawnResult 同形） */
export interface BrokerSpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/** 请求体形态（判别联合各分支去掉 id——Omit 直落联合会塌成单一对象，需分布式条件保形） */
export type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
export type HostRequestBody = DistributiveOmit<HostRequest, "id">;

/** broker → host 应答（ok=false 时 error 为人读消息，调用方按上下文映射 tag） */
export type BrokerReply = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

/** 请求编码（单行 JSON + \n） */
export function encodeHostRequest(msg: HostRequest): string {
  return `${JSON.stringify(msg)}\n`;
}

/** 应答编码（单行 JSON + \n） */
export function encodeBrokerReply(msg: BrokerReply): string {
  return `${JSON.stringify(msg)}\n`;
}

/**
 * 行分帧解码器（两侧共用）：跨 chunk 半行缓冲、一行多消息、空行跳过；
 * 坏 JSON 行上抛（协议破损不静默——进程内尽早暴露）。
 */
export function createLineDecoder<T>(onMessage: (msg: T) => void): { feed(chunk: Buffer | string): void } {
  let buffer = "";
  return {
    feed(chunk) {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line !== "") {
          onMessage(JSON.parse(line) as T);
        }
        nl = buffer.indexOf("\n");
      }
    },
  };
}
