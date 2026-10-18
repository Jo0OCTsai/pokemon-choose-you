/**
 * host 命令契约的公共类型与信封（AD §4.1.1）：客户端半边 → 宿主半边 RPC 的实现表
 * 分域落位（taskCommands / radioCommands / dispatchSettingsCommands / backpackCommands /
 * miscCommands），commands.ts 装配成 49+1 命令表。全部依赖可注入（伪 ctx 集成测试用）。
 */
import type { Conn } from "../storage/db";
import { fail, ok, PkyError, type PkyResult } from "../storage/errors";
import { getSetting } from "../domain/settings";
import type { HealthState } from "../health/snapshot";
import type { LogRing } from "../health/logRing";
import type { PollLoop } from "../radio/pollLoop";
import type { LarkCli } from "../radio/lark";
import type { JudgeExecutor } from "../judge/adapters";
import type { HeadlessDeps } from "../dispatch/headless";
import type { InteractiveDeps, TerminalAdapter } from "../dispatch/interactive";
import type { DeploymentEntity } from "../remote/deployments";
import { RemoteDispatchRejection, type SshTerminalScope } from "../remote/sshExecutor";
import type { SshFamilyProjection } from "../dsh/probeDsh";
import type { BridgeClient } from "../pet/bridge";

/**
 * 远程部署平台面（full-parity 2.9 装配缝）：remote/ 域命令（deployment、provision 族）与
 * 回放远端分支的唯一平台依赖。未装配（非 dsh 宿主 / 家族探测失败）时相关命令按
 * HELPER_CAPABILITY_MISSING 降级拒绝（NFR-12 零静默）。真实实现 = dsh/sshScope.ts 的
 * SshScopeHost + probeDsh 组合（hostEntry 装配），测试注入 fake。
 */
export interface RemoteCommandPlatform {
  /** 按部署取/建 SSH 作用域（家族链；null = 连接不可用） */
  scopeFor(entity: DeploymentEntity): Promise<SshTerminalScope | null>;
  /** 本地 helper 制品权威信息（闭包版本 + sha256——provision 步③④ 与 recheck 基准） */
  readHelperArtifact(): { version: string; sha256: string };
  /** dsh-ssh 家族在位（降级链判定与能力缺失拒绝） */
  sshFamilyAvailable(): boolean;
  /** 关闭部署连接（deploymentDelete 收口；幂等） */
  disconnect(deploymentId: string): Promise<void>;
}

/**
 * 通用终端行注入面（larkLoginStart / 回放本机分支）：向 dsh 终端面板写一行命令。
 * preference = 共享设置 terminal_preference 当前值（desktop 外部终端解析用——调用方
 * 经 injectLineGuarded 统一读取注入）。
 */
export interface TerminalLineInjector {
  injectLine(line: string, preference?: string | null): Promise<void>;
}

/** host 命令实现依赖（createPlugin 装配；测试逐项注入替身） */
export interface HostCommandDeps {
  conn: Conn;
  health: HealthState;
  logs: LogRing;
  /** 运行日志出口（环形缓冲 + 诊断面共用） */
  log(level: "debug" | "info" | "warn" | "error", target: string, message: string): void;
  /** 收音机轮询循环（pollNow 单轮共用；未启动轮询的面板测试可注入只读替身） */
  poll: Pick<PollLoop, "runRound" | "resume">;
  /** lark-cli 封装与可执行路径（larkAuth/larkTest/larkLoginStart） */
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
  // ---- full-parity 2.9 增量（全部可选——未装配时按能力缺失降级，零静默） ----
  /** 远程部署平台面（deployment、provision 族与回放远端分支；缺省 = 相关命令降级拒绝） */
  remote?: RemoteCommandPlatform;
  /**
   * 交互派发远端件（terminalFor 远端分支 + 派发前就绪复核——remoteInteractiveParts
   * 装配；缺省 = 远端交互回落 deps.terminal。debt ③ 接线：本机诚实化由 deps.terminal
   * 承载（dsh 宿主注入 createHandoffTerminal），远端真 PTY/copy-line 由本件承载）
   */
  remoteInteractive?: Pick<InteractiveDeps, "terminalFor" | "deploymentPrecheck">;
  /** 终端行注入面（larkLoginStart/回放本机分支；缺省包装 terminal 适配器） */
  terminalLine?: TerminalLineInjector;
  /** helper 桥面（diagnosticsSnapshot helperCaps / macAuthorizationStatus / exportDirOpen） */
  petBridge?: () => BridgeClient | null;
  /** helper 入口路径（macAuthorizationStatus 回显；缺省空串） */
  helperPath?: () => string;
  /** 快捷键启动注册结果记账（diagnosticsSnapshot.shortcutRegistered；null = 未知不显行） */
  shortcutRegistered?: () => boolean | null;
  /** dsh-ssh 家族探测投影（diagnosticsSnapshot.sshFamily；null = 未探测不显行） */
  sshFamily?: () => SshFamilyProjection | null;
  /** task-state.caught 变体直推（完成路径郑重判定命中时——stateFeed.announceCaught） */
  announceCaught?(variant: { milestone?: number; streakDays?: number }): void;
  /** 桌宠显隐变化后的 sys-config 回推（tray.petVisible 托盘 label 同步——A3） */
  onPetLifecycle?(): void;
}

/** 单条命令实现形态（params → data；抛 PkyError = 错误信封，非 PkyError 上抛） */
export type CommandFn<P = never> = (params: P, deps: HostCommandDeps) => unknown | Promise<unknown>;

/** 命令名 → 实现的分域表 */
export type CommandTable = Record<string, CommandFn<never>>;

/** 终端行注入缺省实现：复用交互派发终端适配器（agent/taskId 为占位——真实适配器只消费 line/preference） */
export function terminalLineOf(deps: Pick<HostCommandDeps, "terminal">): TerminalLineInjector {
  return {
    async injectLine(line, preference) {
      try {
        await deps.terminal.inject({
          line,
          agent: {
            id: "terminal-line",
            name: "terminal",
            command: "sh",
            args: "",
            historyArgs: "",
            workdir: "",
            timeoutSecs: 60,
            enabled: true,
          },
          taskId: 0,
          workdir: null,
          terminalPreference: preference,
        });
      } catch (error) {
        throw new PkyError(
          "DISPATCH_LAUNCH_FAILED",
          `终端注入失败：${String(error instanceof Error ? error.message : error).slice(0, 160)}`,
          "确认 dsh 终端面板可用后重试",
        );
      }
    },
  };
}

/** 命令层取终端行注入面（显式注入优先，缺省包装 terminal 适配器） */
export function lineInjector(deps: HostCommandDeps): TerminalLineInjector {
  return deps.terminalLine ?? terminalLineOf(deps);
}

/**
 * 终端行注入 + 偏好统一读取 + 失败映射兜底（非 PkyError 一律折 DISPATCH_LAUNCH_FAILED
 * ——契约不因注入实现而漂移）。preference 读 deps.conn（主应用 exec.rs 每次唤起前读
 * terminal_pref 同构——运行期改设置即时生效）。
 */
export async function injectLineGuarded(deps: HostCommandDeps, line: string): Promise<void> {
  const preference = getSetting(deps.conn, "terminal_preference");
  try {
    await lineInjector(deps).injectLine(line, preference);
  } catch (error) {
    if (error instanceof PkyError) {
      throw error;
    }
    throw new PkyError(
      "DISPATCH_LAUNCH_FAILED",
      `终端注入失败：${String(error instanceof Error ? error.message : error).slice(0, 160)}`,
      "确认 dsh 终端面板可用后重试",
    );
  }
}

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
    // 远程派发前置拒绝（tag 机器稳定 → PROTOCOL §2 映射：SSH_FAMILY_MISSING 按
    // 纪要③归 HELPER_CAPABILITY_MISSING（宿主平台能力缺席），DEPLOYMENT_NOT_READY 1:1）
    if (error instanceof RemoteDispatchRejection) {
      const code = error.tag === "SSH_FAMILY_MISSING" ? "HELPER_CAPABILITY_MISSING" : "DEPLOYMENT_NOT_READY";
      return fail(
        error.hint === undefined ? new PkyError(code, error.message) : new PkyError(code, error.message, error.hint),
      );
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
