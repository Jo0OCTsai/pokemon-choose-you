/**
 * DshSshScope 实现（从 sshScopeHost.ts 拆出——棘轮 max-lines，等量迁移；
 * sshScope.ts 为统一再出口，消费面不变）：per-deployment 连接 + 进程/文件/终端
 * 操作面。断开语义：显式 disconnect() 幂等收口（终端逐个 terminate + 装载逆序
 * dispose fiber + onDisconnected 通知）。
 */
import { shellViaSpawn, writeFileViaSpawn } from "../remote/sshOps";
import type { SshScope, SshSpawnOptions, SshSpawnResult, SshTerminalOptions } from "../remote/sshScope";
import type { CordisFiber } from "./sshScope";
import { COLLECT_MAX_BYTES, type ConsumerContext, type SubprocessTerminalHandle } from "./sshScopeFamily";

// ---- 常量（对齐 spike 探针实测口径） ----

/** spawn 收口宽限（spike spawnCollect 同值） */
const SPAWN_GRACE_MS = 10_000;
/** 终端会话收口宽限（spike mkTerm 同值） */
const TERMINAL_GRACE_MS = 8_000;
/** 终端缺省尺寸与仿真类型（AD §4.7 交互分支口径） */
const TERMINAL_ROWS = 24;
const TERMINAL_COLS = 120;
const TERMINAL_TYPE = "xterm-256color";

interface DshSshScopeInit {
  deploymentId: string;
  workdir: string;
  services: ConsumerContext;
  /** 装载序 fiber（ssh → subprocess → consumer）；断开按其逆序 dispose */
  fibers: CordisFiber[];
  onDisconnected(id: string): void;
}

function stdinText(input: Buffer | string): string {
  return typeof input === "string" ? input : input.toString("utf8");
}

/** 协议层 cwd/workspace 只收绝对 POSIX 路径（dsh-ssh remotePath schema）——"." 会被拒；
 * workdir 缺省回落根目录（登录目录语义受协议限制，目录导航由脚本/注入行 cd 段承载） */
function wireCwd(workdir: string): string {
  return workdir !== "" ? workdir : "/";
}

export class DshSshScope implements SshScope {
  private connectedState = true;
  private disconnectStarted = false;
  private readonly terminals = new Map<string, SubprocessTerminalHandle>();
  private terminalSeq = 0;

  constructor(private readonly init: DshSshScopeInit) {}

  get connected(): boolean {
    return this.connectedState;
  }

  async spawn(cmd: string[], opts?: SshSpawnOptions): Promise<SshSpawnResult> {
    const startedAt = Date.now();
    const handle = this.init.services.subprocess.spawn({
      argv: cmd,
      cwd: wireCwd(this.init.workdir),
      stdio: {
        stdin: opts?.stdin === undefined ? "ignore" : { data: stdinText(opts.stdin) },
        stdout: { maxBytes: COLLECT_MAX_BYTES },
        stderr: { maxBytes: COLLECT_MAX_BYTES },
      },
      graceMs: SPAWN_GRACE_MS,
      ...(opts?.timeoutMs === undefined ? {} : { signal: AbortSignal.timeout(opts.timeoutMs) }),
    });
    const outcome = await handle.done;
    return {
      code: outcome.exitCode,
      stdout: handle.collected.stdout?.readFrom(0).text ?? "",
      stderr: handle.collected.stderr?.readFrom(0).text ?? "",
      durationMs: Date.now() - startedAt,
    };
  }

  async spawnTerminal(opts: SshTerminalOptions): Promise<{ sessionId: string }> {
    const handle = await this.init.services.subprocess.spawnTerminal({
      argv: [opts.command, ...(opts.args ?? [])],
      cwd: opts.cwd !== undefined && opts.cwd !== "" ? opts.cwd : wireCwd(this.init.workdir),
      rows: TERMINAL_ROWS,
      cols: TERMINAL_COLS,
      terminalType: TERMINAL_TYPE,
      graceMs: TERMINAL_GRACE_MS,
    });
    const sessionId = `pky-term-${handle.pid}-${(this.terminalSeq += 1)}`;
    this.terminals.set(sessionId, handle);
    // 终端自然退出 → 移出登记（防 Map 无界增长；done 拒绝同样收口）
    void Promise.resolve(handle.done)
      .catch(() => undefined)
      .finally(() => this.terminals.delete(sessionId));
    return { sessionId };
  }

  async shell(cmd: string): Promise<{ code: number; stdout: string; stderr: string }> {
    // 组装方（remote/）保证逐参 posixQuote；组合原语单一源（broker 传输同款——remote/sshOps）
    return await shellViaSpawn((c, o) => this.spawn(c, o), cmd);
  }

  async writeFile(path: string, content: Buffer | string): Promise<{ sha256: string }> {
    // 上传原语（NFR-11④）：cat 管道 + sha256 复核——组合原语单一源（remote/sshOps）
    return await writeFileViaSpawn((c, o) => this.spawn(c, o), path, content);
  }

  async disconnect(): Promise<void> {
    if (this.disconnectStarted) {
      return; // 幂等
    }
    this.disconnectStarted = true;
    this.connectedState = false;
    for (const handle of [...this.terminals.values()]) {
      await Promise.resolve(handle.terminate()).catch(() => undefined);
    }
    this.terminals.clear();
    // 装载逆序卸载（consumer → subprocess → ssh）：家族连接最后释放
    await Promise.allSettled([...this.init.fibers].reverse().map((fiber) => fiber.dispose()));
    this.init.onDisconnected(this.init.deploymentId);
  }

  // ---- 接口外扩充（交互派发 TerminalAdapter 消费面——同上下文重派/关闭兜底，任务 2.8 接线） ----

  /** 向已登记终端写入（重派注入用；sessionId 未知/已收口 = false） */
  async writeTerminal(sessionId: string, data: string): Promise<boolean> {
    const handle = this.terminals.get(sessionId);
    if (handle === undefined) {
      return false;
    }
    await handle.write(data);
    return true;
  }

  /** 关闭已登记终端（兜底收口；sessionId 未知/已收口 = false） */
  async terminateTerminal(sessionId: string): Promise<boolean> {
    const handle = this.terminals.get(sessionId);
    if (handle === undefined) {
      return false;
    }
    this.terminals.delete(sessionId);
    await handle.terminate();
    return true;
  }
}
