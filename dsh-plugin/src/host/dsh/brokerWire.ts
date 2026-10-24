/**
 * broker 子进程装线件（从 brokerScope.ts 拆出——复杂度棘轮 max-lines，等量迁移）：
 * 子进程类型面 + 事件装线（stdout 行解码 / stderr 尾部留存 / exit-error 按
 * 「是否出现过协议回合」路由——候选级 vs 传输级）+ spawn 请求体组装。
 */
import type { Readable } from "node:stream";
import { createLineDecoder, type BrokerReply, type HostRequestBody } from "./brokerProtocol";
import { errText } from "./brokerNode";
import type { SshSpawnOptions } from "../remote/sshScope";

/** 子进程面（child_process.spawn 返回形；测试注入内存替身） */
export interface BrokerChildLike {
  stdin: { write(chunk: string): boolean; end(): void } | null;
  stdout: Readable | null;
  stderr: Readable | null;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

/** 子进程工厂（缺省系统 spawn——brokerConnect.ts；测试注入） */
export type BrokerChildFactory = (nodeBin: string, args: string[]) => BrokerChildLike;

/** spawn 请求体组装（argv/cwd 缺省/超时/stdin 归一——与进程内 spawn 同口径） */
export function spawnRequestBody(cmd: string[], opts: SshSpawnOptions | undefined, workdir: string): HostRequestBody {
  const stdin =
    opts?.stdin === undefined ? undefined : typeof opts.stdin === "string" ? opts.stdin : opts.stdin.toString("utf8");
  return {
    op: "spawn",
    argv: cmd,
    cwd: workdir !== "" ? workdir : ".",
    ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    ...(stdin !== undefined ? { stdin } : {}),
  };
}

/** 装线钩子（wireBrokerChild 消费——消亡路由按 hasReply 二分） */
interface WireHooks {
  onReply(msg: BrokerReply): void;
  onStderrTail(chunk: string): void;
  hasReply(): boolean;
  /** 零协议回合消亡（候选级——ENOENT/版本过旧退出） */
  onCandidateGone(reason: string): void;
  /** 已回合后消亡（传输死亡） */
  onTransportGone(reason: string): void;
}

/** 子进程装线：stdout 行解码 → 应答；stderr 尾部留存；exit/error 按「是否出现过
 * 协议回合」路由（候选级 vs 传输级）——单点消化 dsh-ssh 家族之外的进程事件面 */
export function wireBrokerChild(child: BrokerChildLike, hooks: WireHooks): void {
  if (child.stdout === null || child.stdin === null) {
    throw new Error("broker 子进程 stdio 面缺失（pipe 配置破损）");
  }
  const decoder = createLineDecoder<BrokerReply>((msg) => hooks.onReply(msg));
  child.stdout.setEncoding?.("utf8");
  child.stdout.on("data", (chunk: string | Buffer) => decoder.feed(chunk));
  child.stderr?.setEncoding?.("utf8");
  child.stderr?.on("data", (chunk: string | Buffer) => hooks.onStderrTail(String(chunk)));
  child.on("exit", (code, signal) => {
    const tail = `（code=${code} signal=${signal}）`;
    if (hooks.hasReply()) {
      hooks.onTransportGone(`broker 子进程退出${tail}`);
    } else {
      hooks.onCandidateGone(`Node 候选无协议回合即退出${tail}`);
    }
  });
  child.on("error", (error) => {
    const hint = `（系统 Node 在 PATH 不可达？可经 PKY_BROKER_NODE 指定）`;
    if (hooks.hasReply()) {
      hooks.onTransportGone(`broker 子进程派生失败：${errText(error)}${hint}`);
    } else {
      hooks.onCandidateGone(`Node 候选派生失败：${errText(error)}`);
    }
  });
}
