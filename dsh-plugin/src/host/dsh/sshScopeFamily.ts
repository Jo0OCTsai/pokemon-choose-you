/**
 * dsh-ssh 家族装载与 consumer（从 sshScope.ts 拆出——棘轮 max-lines，等量迁移；
 * sshScope.ts 为统一再出口，消费面不变）：动态 import 产物的最小结构类型 +
 * 惰性装载 + consumer 子插件取服务（spike 修正 B：inject 声明 + apply 回调递引用）。
 */
import type { CordisFiber, CordisHostContext } from "./sshScope";

// ---- dsh-ssh 家族服务表面（动态 import 产物的最小结构类型） ----

interface SubprocessCollectSpec {
  maxBytes: number;
}

interface SubprocessStdioSpec {
  stdin: "ignore" | "pipe" | { data: string };
  stdout: "pipe" | "inherit" | SubprocessCollectSpec;
  stderr: "pipe" | "inherit" | SubprocessCollectSpec;
}

interface SubprocessSpawnSpec {
  argv: readonly string[];
  cwd: string;
  stdio: SubprocessStdioSpec;
  graceMs: number;
  signal?: AbortSignal;
}

interface SubprocessOutcome {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

interface SubprocessOutputRead {
  text: string;
}

interface SubprocessOutputReader {
  readFrom(fromByte: number): SubprocessOutputRead;
}

interface SubprocessHandle {
  collected: { stdout?: SubprocessOutputReader; stderr?: SubprocessOutputReader };
  done: Promise<SubprocessOutcome>;
  terminate(): void;
}

interface SubprocessTerminalSpec {
  argv: readonly string[];
  cwd: string;
  rows: number;
  cols: number;
  terminalType: string;
  graceMs: number;
}

interface SubprocessTerminalHandle {
  readonly pid: number;
  readonly done: Promise<SubprocessOutcome>;
  write(data: string): Promise<void>;
  terminate(): Promise<void>;
}

/** subprocess 服务（dsh-subprocess-ssh 注册为 ctx.subprocess） */
interface SubprocessService {
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle;
  spawnTerminal(spec: SubprocessTerminalSpec): Promise<SubprocessTerminalHandle>;
}

/** ssh 连接服务（dsh-ssh 注册为 ctx.ssh；ready 已由 Service.init 门控在装载期内验证） */
interface SshConnectionService {
  readonly ready: Promise<unknown>;
}

/** consumer 子插件 apply 收到的 ctx（声明 inject 后两注入服务可读） */
interface ConsumerContext {
  ssh: SshConnectionService;
  subprocess: SubprocessService;
}

// ---- 常量（对齐 spike 探针实测口径） ----

/** collect 输出上限（无头信封解析余量充足；溢出按 dsh-subprocess 语义保尾部） */
const COLLECT_MAX_BYTES = 8 * 1024 * 1024;
/** consumer 等待 ssh/subprocess 两服务可用的上限（spike loadConsumer 同值） */
const CONSUMER_TIMEOUT_MS = 90_000;

// ---- 家族动态装载（惰性；external 口径——运行时从插件包闭包解析） ----

interface FamilyPlugins {
  sshPlugin: object;
  subprocessPlugin: object;
}

/** 动态 import dsh-ssh 家族（import() 按模块 URL 记忆化，重复调用零额外开销） */
async function loadFamily(): Promise<FamilyPlugins> {
  const [sshMod, subprocessMod] = await Promise.all([
    import("@deepseek-ai/dsh-ssh"),
    import("@deepseek-ai/dsh-subprocess-ssh"),
  ]);
  const pick = (mod: object, pkg: string): object => {
    const face = (mod as { default?: unknown }).default ?? mod;
    if (typeof face !== "function" && typeof face !== "object") {
      throw new Error(`dsh-ssh 家族导出面异常（${pkg} default 非 class/object——版本漂移？）`);
    }
    return face as object;
  };
  return {
    sshPlugin: pick(sshMod, "@deepseek-ai/dsh-ssh"),
    subprocessPlugin: pick(subprocessMod, "@deepseek-ai/dsh-subprocess-ssh"),
  };
}

/** consumer 子插件装载结果（注入服务 + 卸载 fiber） */
export interface ConsumerLoad {
  services: ConsumerContext;
  fiber: CordisFiber;
}

/** consumer 子插件取服务（spike 修正 B：inject 声明 + apply 回调递引用） */
export function loadConsumer(scope: CordisHostContext, tag: string): Promise<ConsumerLoad> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(`ssh 作用域 consumer(${tag}) 未就绪：ssh/subprocess 服务未在 ${CONSUMER_TIMEOUT_MS}ms 内可用`),
        ),
      CONSUMER_TIMEOUT_MS,
    );
    let settled = false;
    const finish = (run: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      run();
    };
    const holder: { fiber?: CordisFiber } = {};
    const consumer = {
      name: `pky-ssh-consumer-${tag}`,
      inject: ["ssh", "subprocess"],
      apply(c: ConsumerContext) {
        // apply 触发时 plugin() 已返回（fiber 就位）；注入服务即本 scope 的连接与执行面
        finish(() => resolve({ services: c, fiber: holder.fiber as CordisFiber }));
      },
    };
    holder.fiber = scope.plugin(consumer, {});
    void Promise.resolve(holder.fiber).catch((error: unknown) => {
      finish(() => reject(error instanceof Error ? error : new Error(String(error))));
    });
  });
}

export { COLLECT_MAX_BYTES, loadFamily };
export type { ConsumerContext, SubprocessHandle, SubprocessTerminalHandle };
