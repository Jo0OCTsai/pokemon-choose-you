/**
 * broker 传输客户端（宿主侧半边；compatibility.md A3 过渡通道）：BoringSSL 宿主
 * （dsh 桌面）里家族连接外包给系统 Node 子进程（dist/broker.mjs——裸 cordis 装配
 * 同一 DshSshScope，TLS-PSK 走系统 OpenSSL）。本类把子进程 stdio JSON 桥包装成
 * SshScope 面（shell/writeFile 组合走 remote/sshOps 单一源，与进程内实现零分叉）。
 *
 * 生命周期：start() 按候选链派生 + connect 握手（失败抛——含 stderr 尾部诊断；
 * 零协议回合消亡的候选自动换下一个，见 brokerNode.ts）；子进程意外退出 → 置断开 +
 * 拒绝全部在途请求 + onDisconnected 通知（与进程内实现同语义：无异步断开事件，
 * 活性归 recheck）。
 *
 * 实现拆件（复杂度棘轮 max-lines，等量迁移）：候选发现与常量 = brokerNode.ts、
 * 子进程装线 = wireBrokerChild、连接装配（sshScopeHost 消费面）= brokerConnect.ts。
 */
import {
  encodeHostRequest,
  type BrokerConnectConfig,
  type BrokerReply,
  type HostRequestBody,
  type HostRequest,
} from "./brokerProtocol";
import { spawnRequestBody, wireBrokerChild, type BrokerChildFactory, type BrokerChildLike } from "./brokerWire";
import {
  CandidateDeadError,
  CONNECT_TIMEOUT_MS,
  errText,
  brokerNodeCandidates,
  SPAWN_TIMEOUT_MS,
  STDERR_TAIL_CHARS,
  TERMINAL_TIMEOUT_MS,
} from "./brokerNode";
import { shellViaSpawn, writeFileViaSpawn } from "../remote/sshOps";
import type { SshScope, SshSpawnOptions, SshSpawnResult, SshTerminalOptions } from "../remote/sshScope";
import type { ScopeDisconnectedListener } from "./sshScopeHost";

export interface BrokerScopeInit {
  nodeBin?: string;
  nodeCandidates?: string[];
  brokerJsPath: string;
  deploymentId: string;
  config: BrokerConnectConfig;
  workdir: string;
  onDisconnected: ScopeDisconnectedListener;
  spawnChild?: BrokerChildFactory;
}

/** 类型再出口（消费面不变——测试与 brokerConnect 经本文件或 brokerWire 均可） */
export type { BrokerChildFactory, BrokerChildLike } from "./brokerWire";

/** 在途请求登记 */
interface PendingEntry {
  resolve(result: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/** 宿主侧 broker scope：SshScope 面 × stdio JSON 桥 */
export class BrokerSshScope implements SshScope {
  private connectedState = false;
  private startPromise: Promise<void> | null = null;
  private transportDead = false;
  private disconnectStarted = false;
  /** connect 握手已成功（disconnect 判定礼貌收线还是直接杀） */
  private connectCompleted = false;
  /** 本候选是否出现过协议回合（应答到达即 node+broker 功能性成立） */
  private gotReply = false;
  private child: BrokerChildLike | null = null;
  private readonly pending = new Map<number, PendingEntry>();
  private nextId = 0;
  private stderrTail = "";

  constructor(private readonly init: BrokerScopeInit) {}

  get connected(): boolean {
    return this.connectedState;
  }

  /** 派生子进程 + connect 握手（幂等；失败可重试——下次 start 重新走候选链） */
  async start(): Promise<void> {
    if (this.startPromise === null) {
      this.startPromise = this.doStart().catch((error: unknown) => {
        this.startPromise = null;
        this.transportDead = false;
        throw error;
      });
    }
    await this.startPromise;
  }

  private async doStart(): Promise<void> {
    const candidates = this.init.nodeCandidates ?? brokerNodeCandidates(this.init.nodeBin);
    let lastDead: Error | null = null;
    for (const candidate of candidates) {
      try {
        await this.tryCandidate(candidate);
        return;
      } catch (error) {
        if (!(error instanceof CandidateDeadError)) {
          throw error; // 协议回合已发生过（node 本身可用）——连接失败如实上抛
        }
        lastDead = error;
      }
    }
    throw new Error(
      `broker 传输不可用：全部 Node 候选失败（${candidates.join("、")}）。最近：${lastDead === null ? "" : errText(lastDead)}。可安装系统 Node ≥ 20 或经 PKY_BROKER_NODE 指定`,
    );
  }

  /** 单候选尝试：派生 + 装线 + connect；零回合消亡 → 抛 CandidateDead（上层换候选） */
  private async tryCandidate(nodeBin: string): Promise<void> {
    this.gotReply = false;
    const child = this.spawnBrokerChild(nodeBin);
    this.child = child;
    let dead: CandidateDeadError | null = null;
    wireBrokerChild(child, {
      onReply: (msg) => this.onReply(msg),
      onStderrTail: (chunk) => {
        this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_TAIL_CHARS);
      },
      hasReply: () => this.gotReply,
      onCandidateGone: (reason) => {
        if (dead === null) {
          dead = new CandidateDeadError(`${reason}${this.stderrTailSuffix()}`);
          this.child = null;
          this.failPending(`${reason}${this.stderrTailSuffix()}`);
        }
      },
      onTransportGone: (reason) => this.onChildGone(`${reason}${this.stderrTailSuffix()}`),
    });
    try {
      await this.request(
        {
          op: "connect",
          config: this.init.config,
          deploymentId: this.init.deploymentId,
          workdir: this.init.workdir,
        },
        CONNECT_TIMEOUT_MS,
      );
    } catch (error) {
      throw dead ?? error; // 消亡在先 → 候选级；子进程活着 → 连接失败如实（node 可用）
    }
    if (dead !== null) {
      throw dead;
    }
    this.connectedState = true;
    this.connectCompleted = true;
  }

  private spawnBrokerChild(nodeBin: string): BrokerChildLike {
    const spawnChild = this.init.spawnChild;
    if (spawnChild === undefined) {
      throw new Error(`broker 子进程派生缺省工厂未装配（${nodeBin}）——经 brokerConnect 装配`);
    }
    try {
      return spawnChild(nodeBin, [this.init.brokerJsPath]);
    } catch (error) {
      throw new Error(
        `broker 子进程派生失败：${errText(error)}（系统 Node 在 PATH 不可达？可经 PKY_BROKER_NODE 指定）`,
      );
    }
  }

  async spawn(cmd: string[], opts?: SshSpawnOptions): Promise<SshSpawnResult> {
    return (await this.request(spawnRequestBody(cmd, opts, this.init.workdir), SPAWN_TIMEOUT_MS)) as SshSpawnResult;
  }

  async spawnTerminal(opts: SshTerminalOptions): Promise<{ sessionId: string }> {
    return (await this.request(
      {
        op: "spawnTerminal",
        argv: [opts.command, ...(opts.args ?? [])],
        ...(opts.cwd !== undefined && opts.cwd !== "" ? { cwd: opts.cwd } : {}),
      },
      TERMINAL_TIMEOUT_MS,
    )) as { sessionId: string };
  }

  async shell(cmd: string): Promise<{ code: number; stdout: string; stderr: string }> {
    // 组装方（remote/）保证逐参 posixQuote；组合原语单一源（进程内实现同款）
    return await shellViaSpawn((c, o) => this.spawn(c, o), cmd);
  }

  async writeFile(path: string, content: Buffer | string): Promise<{ sha256: string }> {
    return await writeFileViaSpawn((c, o) => this.spawn(c, o), path, content);
  }

  /** 向已登记终端写入（sessionId 未知/已收口 = false——与进程内实现同语义） */
  async writeTerminal(sessionId: string, data: string): Promise<boolean> {
    const out = (await this.request({ op: "writeTerminal", sessionId, data }, TERMINAL_TIMEOUT_MS)) as { ok: boolean };
    return out.ok;
  }

  /** 关闭已登记终端（sessionId 未知/已收口 = false） */
  async terminateTerminal(sessionId: string): Promise<boolean> {
    const out = (await this.request({ op: "terminateTerminal", sessionId }, TERMINAL_TIMEOUT_MS)) as { ok: boolean };
    return out.ok;
  }

  async disconnect(): Promise<void> {
    if (this.disconnectStarted) {
      return; // 幂等
    }
    this.disconnectStarted = true;
    this.connectedState = false;
    if (this.child !== null && this.connectCompleted) {
      // 已完成 connect：礼貌收线（disconnect 应答后 broker 自退）；子进程滞留则补杀
      await this.request({ op: "disconnect" }, TERMINAL_TIMEOUT_MS).catch(() => undefined);
    }
    this.child?.stdin?.end();
    this.child?.kill();
    this.failPending("连接已关闭");
    this.init.onDisconnected(this.init.deploymentId);
  }

  // ---- 内部（请求关联 / 子进程消亡收口） ----

  private async request(req: HostRequestBody, timeoutMs: number): Promise<unknown> {
    if (this.transportDead && req.op !== "disconnect") {
      throw new Error("broker 传输已断开");
    }
    if (this.child === null) {
      await this.start();
    }
    if (!this.connectedState && req.op !== "connect" && req.op !== "disconnect") {
      throw new Error("broker 传输已断开");
    }
    const child = this.child;
    if (child === null || child.stdin === null) {
      throw new Error("broker 子进程不在场");
    }
    const id = (this.nextId += 1);
    const full = { ...req, id } as HostRequest;
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`broker 请求超时（op ${full.op}，${timeoutMs}ms）`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    child.stdin.write(encodeHostRequest(full)); // 背压由流缓冲（请求体量小）
    return await promise;
  }

  private onReply(msg: BrokerReply): void {
    this.gotReply = true;
    const entry = this.pending.get(msg.id);
    if (entry === undefined) {
      return; // 超时后迟到应答——丢弃
    }
    this.pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.ok) {
      entry.resolve(msg.result);
    } else {
      entry.reject(new Error(`${msg.error}${this.stderrTailSuffix()}`));
    }
  }

  private onChildGone(reason: string): void {
    this.connectedState = false;
    this.connectCompleted = false;
    this.transportDead = true;
    this.child = null;
    this.failPending(reason);
    if (!this.disconnectStarted) {
      this.disconnectStarted = true; // 传输已死——后续 disconnect 只走通知收口
      this.init.onDisconnected(this.init.deploymentId);
    }
  }

  private failPending(reason: string): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    this.pending.clear();
  }

  private stderrTailSuffix(): string {
    return this.stderrTail === "" ? "" : `；broker stderr 尾部：…${this.stderrTail.slice(-400)}`;
  }
}
