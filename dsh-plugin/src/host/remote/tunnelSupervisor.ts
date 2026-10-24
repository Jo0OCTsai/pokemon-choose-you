/**
 * 常驻反向隧道 supervisor（ADR-0003 §2/§3 · 与桌面 tunnel.rs 同构配方）：
 * `ssh -N -R 127.0.0.1:<port>:127.0.0.1:22 <alias>`（ServerAlive 10s×3 探死 +
 * ExitOnForwardFailure 杜绝假隧道 + 指数退避 1s→30s、稳定 60s 复位），维护权经
 * 让位锁与桌面 app 协调——任一宿主驻留期维持、退出自动接管（可用性契约）。
 * 本目录零 dsh import（node:child_process 平台中立）；装配与生命周期归 dsh/ 适配层。
 */
import { type ChildProcess, spawn } from "node:child_process";
import type { DeploymentEntity } from "./deployments";
import { defaultLockBase, holderPid, tryAcquireTunnelLock, type TunnelLock } from "./tunnelLock";

/** 隧道身份（与桌面 TunnelKey 同构：一部署一隧道） */
export interface TunnelKey {
  deploymentId: string;
  alias: string;
  tunnelPort: number;
}

export function tunnelKeyOf(entity: DeploymentEntity): TunnelKey | null {
  // 存量实体可能缺 pkTunnel 键（ADR-0003 之前落库，读值 undefined）——按未配置处理
  const t = entity.pkTunnel;
  if (t === null || t === undefined || !t.persistent || t.port === 0 || entity.alias.trim() === "") {
    return null;
  }
  return { deploymentId: entity.id, alias: entity.alias.trim(), tunnelPort: t.port };
}

/** 状态：off / connecting / healthy / retrying / yielded（让位待命，可区分于重连） */
export type TunnelState = "off" | "connecting" | "healthy" | "retrying" | "yielded";

export interface TunnelStatus {
  state: TunnelState;
  detail: string;
}

/** autossh 配方（与桌面 tunnel_argv 逐参一致；alias 模式无 -i/-p） */
export function tunnelArgv(k: TunnelKey): string[] {
  return [
    "-N",
    "-R",
    `127.0.0.1:${k.tunnelPort}:127.0.0.1:22`,
    "-o",
    "BatchMode=yes",
    "-o",
    "ServerAliveInterval=10",
    "-o",
    "ServerAliveCountMax=3",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ConnectTimeout=10",
    "--",
    k.alias,
  ];
}

interface Entry {
  stop: () => void;
  status: () => TunnelStatus;
}

/** 让位重查与退避节奏（秒；与桌面同量级） */
const YIELD_RECHECK_SECS = 10;
const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const HEALTHY_AFTER_MS = 3_000;
const HEALTHY_HOLD_MS = 60_000;

/** 状态迁移日志回调（hostEntry 接统一日志面；本目录零依赖保持平台中立） */
export type TunnelLogFn = (level: "info" | "warn", message: string) => void;

/**
 * 多部署隧道 supervisor：sync 与部署注册表对齐（停掉不再开启的、补起缺失的），
 * statusOf 供面板呈现。ssh 程序与锁根目录可注入（测试用假 ssh + 临时目录）。
 */
export class TunnelSupervisor {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly opts: { sshBin?: string; lockBase?: string; log?: TunnelLogFn } = {}) {}

  private get base(): string {
    return this.opts.lockBase ?? defaultLockBase();
  }

  sync(deployments: DeploymentEntity[]): void {
    const desired = new Map<string, TunnelKey>();
    for (const d of deployments) {
      const k = tunnelKeyOf(d);
      if (k !== null) {
        desired.set(d.id, k);
      }
    }
    for (const [id, entry] of this.entries) {
      if (!desired.has(id)) {
        entry.stop();
        this.entries.delete(id);
      }
    }
    for (const [id, key] of desired) {
      if (!this.entries.has(id)) {
        this.entries.set(id, spawnSupervisor(key, this.opts.sshBin ?? "ssh", this.base, this.opts.log));
      }
    }
  }

  stopAll(): void {
    this.sync([]);
  }

  statusOf(deploymentId: string): TunnelStatus {
    const entry = this.entries.get(deploymentId);
    return entry === undefined ? { state: "off", detail: "常驻隧道未运行" } : entry.status();
  }
}

/** 单部署 supervisor：锁让位 → 持锁 ssh 保活（退避重连）；stop = 杀循环 + 释放锁 */
class SingleTunnelRunner {
  private stopped = false;
  private child: ChildProcess | undefined;
  private lock: TunnelLock | null = null;
  private backoffMs = BACKOFF_START_MS;
  private stableSince = 0;
  private lastErrTail = "";
  private statusValue: TunnelStatus = { state: "connecting", detail: "建立 ssh -R 连接" };
  private loggedState: TunnelState | null = null;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly key: TunnelKey,
    private readonly sshBin: string,
    private readonly base: string,
    private readonly log: TunnelLogFn | undefined,
  ) {
    this.attempt();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
    }
    this.child?.kill("SIGTERM");
    this.child = undefined;
    this.lock?.release();
    this.lock = null;
  }

  status(): TunnelStatus {
    return { ...this.statusValue };
  }

  private setStatus(s: TunnelStatus): void {
    this.statusValue = s;
    // 日志按 episode 去重：退避循环 connecting↔retrying 高频往复、yielded 每 10s 重查，
    // 状态不变不重复记、connecting 不单独记（healthy/retrying 行已覆盖语义）——面板
    // statusOf 不受影响仍实时；否则断连日会刷爆共享日志的 512KB 轮转窗口
    if (this.log === undefined || s.state === "connecting" || s.state === this.loggedState) {
      return;
    }
    this.loggedState = s.state;
    this.log(
      s.state === "retrying" ? "warn" : "info",
      `隧道 ${this.key.alias}（127.0.0.1:${this.key.tunnelPort}）${s.detail}`,
    );
  }

  private schedule(ms: number, fn: () => void): void {
    this.timer = setTimeout(fn, ms);
    this.timer.unref?.();
  }

  /** 一次尝试：先锁（让位 → yielded 周期重查），持锁后拉起 ssh */
  private attempt(): void {
    if (this.stopped) {
      return;
    }
    this.lock = tryAcquireTunnelLock(this.base, this.key.deploymentId);
    if (this.lock === null) {
      const holder = holderPid(this.base, this.key.deploymentId);
      this.setStatus({
        state: "yielded",
        detail: `另一宿主（PID ${holder ?? "?"}）正在维持本部署隧道，让位待命中`,
      });
      this.schedule(YIELD_RECHECK_SECS * 1000, () => this.attempt());
      return;
    }
    this.setStatus({ state: "connecting", detail: "建立 ssh -R 连接" });
    this.spawnSsh();
  }

  /** 拉起 ssh 并接线退出/错误 → 退避重试；健康判定定时器转 healthy */
  private spawnSsh(): void {
    let lastTailAt = 0;
    this.child = spawn(this.sshBin, tunnelArgv(this.key), {
      stdio: ["ignore", "ignore", "pipe"],
    });
    this.child.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line !== "") {
        this.lastErrTail = line;
        lastTailAt = Date.now();
      }
    });
    this.child.on("error", (err) => {
      if (!this.stopped) {
        this.retry(`无法启动 ssh（${String(err)}）`);
      }
    });
    this.child.on("exit", (code) => {
      if (this.stopped) {
        return;
      }
      if (Date.now() - lastTailAt > 5_000) {
        this.lastErrTail = `连接断开（exit ${code ?? "?"}，无输出）`;
      }
      this.retry(this.lastErrTail);
    });
    // 健康判定：撑过 HEALTHY_AFTER 即转 healthy（同桌面语义；稳定满 60s 复位退避）
    this.schedule(HEALTHY_AFTER_MS, () => {
      if (this.stopped || this.child === undefined) {
        return;
      }
      this.setStatus({
        state: "healthy",
        detail: `${this.key.alias} ⇄ 127.0.0.1:${this.key.tunnelPort} 已连通（keepalive 自愈中）`,
      });
      this.stableSince = Date.now();
    });
  }

  /** 退避重试（稳定满 HEALTHY_HOLD 复位） */
  private retry(reason: string): void {
    this.child?.kill("SIGTERM");
    this.child = undefined;
    if (this.stableSince > 0 && Date.now() - this.stableSince >= HEALTHY_HOLD_MS) {
      this.backoffMs = BACKOFF_START_MS;
    }
    this.stableSince = 0;
    this.setStatus({
      state: "retrying",
      detail: `${reason}，${Math.round(this.backoffMs / 1000)}s 后重试`,
    });
    this.schedule(this.backoffMs, () => this.attempt());
    this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
  }
}

function spawnSupervisor(key: TunnelKey, sshBin: string, base: string, log: TunnelLogFn | undefined): Entry {
  const runner = new SingleTunnelRunner(key, sshBin, base, log);
  return { stop: () => runner.stop(), status: () => runner.status() };
}
