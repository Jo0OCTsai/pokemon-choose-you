/**
 * helper 进程监督（AD §3.3 生命周期 / FR-P1）：spawn 接口注入（真实 helper 二进制
 * 路径后续装配；测试用 node fake helper 子进程）→ 崩溃检测（exit 事件）→ 10 秒内
 * 自拉起（状态与位置恢复：重启后经 onBridgeReady 重发配置与状态快照，位置经
 * --pos 启动参数恢复）→「隐藏桌宠」= 停进程（不再自拉起；petHide/petShow 生命周期
 * 导出）→「随 dsh 启动」默认开（Config 双轨 A2——本模块只提供 host 侧开关读写接口，
 * 持久化归 dsh Config schema 装配层）。
 */
import { spawn } from "node:child_process";
import { BridgeClient, type BridgeClientHandlers } from "./bridge";
import type { HelloMsg } from "../../../helper/src/bridge/protocol";

/** 崩溃自拉起 SLA（毫秒内重启；AD §3.3「10 秒内自拉起」） */
export const RESTART_SLA_MS = 10_000;

/** 缺省重启延迟（毫秒；远小于 SLA，给 OS 一点进程收尾窗口） */
export const DEFAULT_RESTART_DELAY_MS = 1_000;

/** helper 子进程最小面（真实 ChildProcess 的结构子集——fake 可替） */
export interface HelperChild {
  pid?: number;
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr?: NodeJS.ReadableStream;
  on(event: "exit", cb: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  once(event: "exit", cb: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  kill(signal?: NodeJS.Signals): void;
}

/** spawn 接口（注入点：真实 helper 二进制路径 / 测试 fake helper 脚本） */
export interface HelperSpawner {
  spawn(args: string[]): HelperChild;
}

/** node 脚本形态 spawner（fake helper 子进程 / HELPER_HEADLESS=1 纯协议形态） */
export function nodeScriptSpawner(scriptPath: string, env: Record<string, string> = {}): HelperSpawner {
  return {
    spawn(args: string[]) {
      const child = spawn(process.execPath, [scriptPath, ...args], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...env },
      });
      return {
        pid: child.pid,
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        on: (event, cb) => child.on(event, cb),
        once: (event, cb) => child.once(event, cb),
        kill: (signal) => child.kill(signal),
      };
    },
  };
}

/**
 * electron 形态 spawner（真实 helper 拉起）：入口必须是 dist/main.js **文件**——
 * 传 dist 目录时 Electron default_app 因目录内无 package.json/index.js 解析失败，
 * 弹原生错误框后 exit(1)（supervisor 再每秒重启成死循环，桌宠永远不显示）。
 * env 剥离 ELECTRON_RUN_AS_NODE——desktop 宿主进程自身以 node 模式跑 Electron
 * （进程 env 带该变量），完整继承会把 helper 的 Electron 二进制也打成纯 node：
 * import electron 即崩、进程秒退，supervisor 静默死循环（桌宠不显示真机根因）。
 */
export function electronSpawner(electronBin: string, helperMain: string): HelperSpawner {
  return {
    spawn(args: string[]) {
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(electronBin, [helperMain, ...args], {
        stdio: ["pipe", "pipe", "pipe"],
        env,
      });
      return {
        pid: child.pid,
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        on: (event, cb) => child.on(event, cb),
        once: (event, cb) => child.once(event, cb),
        kill: (signal) => child.kill(signal),
      };
    },
  };
}

export interface PetSupervisorOptions {
  spawner: HelperSpawner;
  /** 上行处理（cmd/focus-settle 分发到 cmdHandler；装配层注入） */
  handlers: BridgeClientHandlers;
  /** 宿主进程号（--host-pid 双保险；缺省不传） */
  hostPid?: number;
  /** 恢复位置（--pos 启动参数；缺省不传——首次由 helper 落默认位） */
  getPos?(): { x: number; y: number } | null;
  /** 重启后回调（状态与位置恢复出口：republishAll 快照 + hello 证据） */
  onBridgeReady?(bridge: BridgeClient, hello: HelloMsg, restartNo: number): void;
  /** 重启延迟（测试注入短值；须 ≤ RESTART_SLA_MS） */
  restartDelayMs?: number;
  /** hello 等待超时（show() 返回前的握手窗；测试注入短值） */
  helloTimeoutMs?: number;
}

/** 「随 dsh 启动」开关读写接口（A2 Config 双轨：默认开；持久化归 Config schema 装配层） */
export interface PetAutoStartStore {
  get(): boolean;
  set(value: boolean): void;
}

/** 内存实现（缺省；插件 Config schema 装配后替换为平台持久化实现） */
export function memoryPetAutoStartStore(initial = true): PetAutoStartStore {
  const state = { value: initial };
  return {
    get: () => state.value,
    set: (value) => {
      state.value = value;
    },
  };
}

/**
 * 桌宠监督器：show/hide 生命周期 + 崩溃自拉起。一次一代（重启即新 BridgeClient，
 * hello 握手完成后 onBridgeReady 恢复状态）；hide = 主动停止（exit 不再触发重启）。
 */
export class PetSupervisor {
  private child: HelperChild | null = null;
  private bridge: BridgeClient | null = null;
  private intendedRunning = false;
  private restartTimer: NodeJS.Timeout | null = null;
  private readonly opts: PetSupervisorOptions;
  private restartCount = 0;

  constructor(opts: PetSupervisorOptions) {
    this.opts = opts;
  }

  get running(): boolean {
    return this.child !== null;
  }

  /** 崩溃自拉起次数（排障观测点） */
  get restarts(): number {
    return this.restartCount;
  }

  currentBridge(): BridgeClient | null {
    return this.bridge;
  }

  /** 拉起 helper 并等 hello 握手（超时不视为失败——迟到仍触发 onBridgeReady） */
  async show(): Promise<HelloMsg | null> {
    if (this.intendedRunning) {
      return this.bridge?.hello ?? null;
    }
    this.intendedRunning = true;
    this.spawnOnce(0);
    return this.waitHello();
  }

  /** 隐藏桌宠 = 停进程（其余功能不受影响；不再自拉起） */
  hide(): void {
    this.intendedRunning = false;
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.stopChild();
  }

  dispose(): void {
    this.hide();
  }

  private spawnOnce(restartNo: number): void {
    const args: string[] = [];
    if (this.opts.hostPid !== undefined) {
      args.push(`--host-pid=${this.opts.hostPid}`);
    }
    const pos = this.opts.getPos?.();
    if (pos !== null && pos !== undefined) {
      args.push(`--pos=${Math.round(pos.x)},${Math.round(pos.y)}`);
    }
    const child = this.opts.spawner.spawn(args);
    this.child = child;
    const bridge = new BridgeClient({ handlers: this.opts.handlers });
    bridge.attach(child.stdout, child.stdin);
    bridge.onReady((hello) => {
      bridge.startHeartbeat();
      this.opts.onBridgeReady?.(bridge, hello, restartNo);
    });
    this.bridge = bridge;
    child.once("exit", () => {
      if (this.bridge === bridge) {
        bridge.detach();
        this.bridge = null;
      }
      if (this.child === child) {
        this.child = null;
      }
      if (!this.intendedRunning) {
        return; // hide()/dispose() 主动停止：不重启
      }
      // 崩溃：SLA 内自拉起（延迟注入便于测试）
      const delay = Math.min(this.opts.restartDelayMs ?? DEFAULT_RESTART_DELAY_MS, RESTART_SLA_MS);
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        this.restartCount++;
        this.spawnOnce(this.restartCount);
      }, delay);
    });
  }

  private stopChild(): void {
    const child = this.child;
    this.child = null;
    this.bridge?.detach();
    this.bridge = null;
    child?.kill("SIGTERM");
  }

  private waitHello(): Promise<HelloMsg | null> {
    // waitHello 只在 spawnOnce 之后同步调用（hello 尚未到达，走 onReady/超时两路）；
    // bridge 为 null 属未来 API 误用防御
    const timeoutMs = this.opts.helloTimeoutMs ?? 5_000;
    const bridge = this.bridge;
    if (bridge === null) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      const off = bridge.onReady((hello) => {
        clearTimeout(timer);
        resolve(hello);
      });
      const timer = setTimeout(() => {
        off();
        resolve(bridge.hello);
      }, timeoutMs);
    });
  }
}
