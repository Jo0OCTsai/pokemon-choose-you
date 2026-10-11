/**
 * host 命令契约的公共类型与信封（AD §4.1.1）：客户端半边 → 宿主半边 RPC 的实现表
 * 分域落位（taskCommands / radioCommands / dispatchSettingsCommands / backpackCommands /
 * miscCommands），commands.ts 装配成 49+1 命令表。全部依赖可注入（伪 ctx 集成测试用）。
 */
import type { Conn } from "../storage/db";
import { fail, ok, PkyError, type PkyResult } from "../storage/errors";
import type { HealthState } from "../health/snapshot";
import type { LogRing } from "../health/logRing";
import type { PollLoop } from "../radio/pollLoop";
import type { LarkCli } from "../radio/lark";
import type { JudgeExecutor } from "../judge/adapters";
import type { HeadlessDeps } from "../dispatch/headless";
import type { TerminalAdapter } from "../dispatch/interactive";

/** host 命令实现依赖（createPlugin 装配；测试逐项注入替身） */
export interface HostCommandDeps {
  conn: Conn;
  health: HealthState;
  logs: LogRing;
  /** 运行日志出口（环形缓冲 + 诊断面共用） */
  log(level: "debug" | "info" | "warn" | "error", target: string, message: string): void;
  /** 收音机轮询循环（pollNow 单轮共用；未启动轮询的面板测试可注入只读替身） */
  poll: Pick<PollLoop, "runRound" | "resume">;
  /** lark-cli 封装与可执行路径（larkAuth/larkTest） */
  lark: LarkCli;
  larkBin: string;
  /** 快捕/重判的判定执行方工厂（null = 未配置 AI agent） */
  newExecutor: () => JudgeExecutor | null;
  /** 无头派发依赖（执行器/worktree/ssh 预检——可注入） */
  dispatchDeps: HeadlessDeps;
  /** 交互派发终端适配器 */
  terminal: TerminalAdapter;
  /** 桌宠生命周期（petShow/petHide/pomoTryFive） */
  pet: { show(): Promise<unknown>; hide(): void; readonly running: boolean };
  /** domain 写后直推（stateFeed.notifyLocalWrite——写命令收尾调用） */
  onWrites(): void;
  /** pageOpen host→客户端推送出口（dsh 客户端导航通道由适配层接线） */
  openPage(section?: "panel" | "settings"): void;
  /** lark-cli 可执行存在性（diagnosticsSnapshot 的 feishuConfigured 位） */
  feishuConfigured: boolean;
  /** 支持报告元信息（插件版本/dsh 版本占位） */
  meta: { pluginVersion: string; dshVersion?: string | null };
}

/** 单条命令实现形态（params → data；抛 PkyError = 错误信封，非 PkyError 上抛） */
export type CommandFn<P = never> = (params: P, deps: HostCommandDeps) => unknown | Promise<unknown>;

/** 命令名 → 实现的分域表 */
export type CommandTable = Record<string, CommandFn<never>>;

/** 装配后的调用面：统一 ok/fail 信封（PROTOCOL §2） */
export type HostCommandCaller = (command: string, params?: unknown) => Promise<PkyResult<unknown>>;

/** 把一条命令实现包成 ok/fail 信封（PkyError → error；其余异常上抛不静默） */
export async function envelope(fn: CommandFn, params: unknown, deps: HostCommandDeps): Promise<PkyResult<unknown>> {
  try {
    return ok(await fn((params ?? {}) as never, deps));
  } catch (error) {
    if (error instanceof PkyError) {
      return fail(error);
    }
    throw error;
  }
}

/** 放生撤销快照（taskDelete → taskDeleteUndo 的 5 秒窗口载体；进程内单槽） */
export interface DeleteUndoSnapshot {
  /** 任务行（SQL 列原样，还原时按列序回插） */
  task: Record<string, string | number | null>;
  tagIds: number[];
  notes: Array<{ content: string; source: string; created_at: string }>;
}
