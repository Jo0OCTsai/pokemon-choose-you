/**
 * 宿主存亡探测（AD §3.3 生命周期）：
 * - 心跳管道守卫：宿主静默超过阈值（默认 15s，可配）判死——任意下行数据（含坏行）都算活着，
 *   静默才是死亡信号；
 * - stdin 管道守卫：stdin end/error 由 bridge 直接判死；
 * - --host-pid 轮询双保险：宿主进程号探测（process.kill(pid, 0)），宿主退则 helper 10s 内自杀。
 */

export type HostDeathReason = "stdin-end" | "stdin-error" | "heartbeat-timeout" | "host-pid-dead";

/** 心跳/静默看门狗（纯逻辑：时间注入，便于测试） */
export class LivenessWatchdog {
  private readonly timeoutMs: number;
  private lastSeen: number;
  private dead = false;

  constructor(timeoutMs: number, now: () => number) {
    this.timeoutMs = timeoutMs;
    this.lastSeen = now();
  }

  /** 任意宿主数据到达（含心跳与坏行） */
  feed(now: number): void {
    this.lastSeen = now;
  }

  /** 是否已静默超时（一旦判死保持死态，直到 restart） */
  isDead(now: number): boolean {
    if (!this.dead && now - this.lastSeen > this.timeoutMs) this.dead = true;
    return this.dead;
  }

  restart(now: number): void {
    this.lastSeen = now;
    this.dead = false;
  }
}

/** --host-pid 轮询守卫（Node 进程面；hostPid 缺省时不启用） */
export class HostPidWatchdog {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly hostPid: number;
  private readonly onDead: (reason: HostDeathReason) => void;
  private readonly pollMs: number;
  private readonly isAlive: (pid: number) => boolean;

  constructor(
    hostPid: number,
    onDead: (reason: HostDeathReason) => void,
    pollMs = 2_000,
    isAlive: (pid: number) => boolean = defaultPidAlive,
  ) {
    this.hostPid = hostPid;
    this.onDead = onDead;
    this.pollMs = pollMs;
    this.isAlive = isAlive;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (!this.isAlive(this.hostPid)) {
        this.stop();
        this.onDead("host-pid-dead");
      }
    }, this.pollMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM = 进程存在但无权限发信号（不同用户）——视为活着
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}
