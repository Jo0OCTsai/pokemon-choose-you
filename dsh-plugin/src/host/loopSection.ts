/**
 * 插件装配的循环与增量命令依赖段（从 assembly.ts 拆出以控文件行数棘轮——
 * 与 petSection.ts 同款拆件先例）：提醒循环（FR-A3 · AD §4.6）+ 每日备份循环
 * （D33/A36）+ full-parity 2.7/2.9 的 HostCommandDeps 可选面组装。
 */
import type { Conn } from "./storage/db";
import { dataDirFrom } from "./storage/paths";
import { createPollLoop, realTimer, type PollLoop, type TimerApi } from "./radio/pollLoop";
import type { LarkCli } from "./radio/lark";
import type { HealthState } from "./health/snapshot";
import { startAutoDispatchLoop, systemTimer, type AutoDispatchLoop } from "./dispatch/autoDispatch";
import { runDailyBackup, type DailyBackupOutcome } from "./domain/backup-loop";
import type { StateFeed } from "./pet/stateFeed";
import type { PetSupervisor } from "./pet/supervisor";
import { createReminderLoop, type ReminderLoop } from "./reminder/loop";
import { ReminderDelivery } from "./reminder/deliver";
import type { HostCommandDeps, RemoteCommandPlatform } from "./commands";
import { remoteHeadlessDeps } from "./remote/sshExecutor";
import type { PluginDeps } from "./assembly";
import type { JudgeExecutor } from "./judge/adapters";

/** 备份循环间隔（AD §3.2/A36：30min 惶——跨天判定在 domain） */
export const BACKUP_LOOP_INTERVAL_MS = 30 * 60_000;

/** 收音机轮询/自动派发循环段装配（timer 全注入；启动即跑一轮轮询） */
export function assemblePollLoops(args: {
  conn: Conn;
  deps: PluginDeps;
  lark: LarkCli;
  health: HealthState;
  log: HostCommandDeps["log"];
  newExecutor: (c: Conn) => JudgeExecutor | null;
}): { poll: PollLoop; auto: AutoDispatchLoop } {
  const { conn, deps } = args;
  const poll = createPollLoop({
    conn,
    lark: args.lark,
    health: args.health,
    newExecutor: () => args.newExecutor(conn),
    timer: deps.pollTimer ?? realTimer,
    log: (level, message) => args.log(level, "radio", message),
    onEvent: (event) => args.log("warn", "radio", `event: ${event}`),
  });
  const auto = startAutoDispatchLoop(conn, deps.dispatchDeps ?? {}, {
    timer: deps.autoTimer ?? systemTimer,
    onError: (error) => args.log("warn", "dispatch-auto", String(error)),
  });
  return { poll, auto };
}

/** 每日备份循环（30min tick；跨天判定/条件写键/prune/空库跳过全在 domain——A36） */
function startBackupLoopTicked(
  conn: Conn,
  deps: PluginDeps,
  log: HostCommandDeps["log"],
): { stop(): void; runOnce(): DailyBackupOutcome } {
  const timer = deps.backupTimer ?? realTimer;
  const runOnce = (): DailyBackupOutcome => {
    const dir = dataDirFrom();
    if (dir === undefined) {
      log("warn", "backup-loop", "无法定位数据目录，本轮备份跳过");
      return { created: false, file: null, reason: "backup-failed", keyWritten: false };
    }
    const outcome = runDailyBackup(dir, conn);
    if (outcome.created) {
      log("info", "backup-loop", `每日备份完成：${outcome.file ?? ""}`);
    } else if (outcome.reason === "backup-failed") {
      log("warn", "backup-loop", "备份失败（下轮重试——键未写）");
    }
    return outcome;
  };
  const stop = timer(runOnce, BACKUP_LOOP_INTERVAL_MS);
  return { stop, runOnce };
}

/** 提醒 + 备份循环段装配（timer 全注入；桥面经 supervisor 当前桥） */
export function assembleLoopsFull(args: {
  conn: Conn;
  deps: PluginDeps;
  supervisor: PetSupervisor | null;
  log: HostCommandDeps["log"];
  stateFeed: StateFeed;
}): {
  reminder: ReminderLoop;
  reminderDelivery: ReminderDelivery;
  backupLoop: { stop(): void; runOnce(): DailyBackupOutcome };
} {
  // 提醒循环（FR-A3 · AD §4.6）：桥面在位走 helper sys-notify；缺席 toast 降级 + 补看面
  const reminderDelivery = new ReminderDelivery({
    bridge: () => args.supervisor?.currentBridge() ?? null,
  });
  const reminder = createReminderLoop({
    conn: args.conn,
    delivery: reminderDelivery,
    timer: args.deps.reminderTimer,
    log: (level, message) => args.log(level, "reminder", message),
    onWrites: () => args.stateFeed.notifyLocalWrite(),
  });
  return {
    reminder,
    reminderDelivery,
    backupLoop: startBackupLoopTicked(args.conn, args.deps, args.log),
  };
}

/** full-parity 2.7/2.9 的 HostCommandDeps 可选面（缺省按能力缺失降级——零静默） */
export function parityCommandDeps(args: {
  conn: Conn;
  deps: PluginDeps;
  supervisor: PetSupervisor | null;
  stateFeed: StateFeed;
}): Pick<
  HostCommandDeps,
  "dispatchDeps" | "remote" | "petBridge" | "helperPath" | "sshFamily" | "announceCaught" | "onPetLifecycle"
> & { dispatchDeps: HostCommandDeps["dispatchDeps"] } {
  const { conn, deps, supervisor, stateFeed } = args;
  const remote: RemoteCommandPlatform | undefined = deps.remote;
  return {
    // 远程平台面在位时：无头派发路由 local/ssh/直连 + worktreeFor + 派发前就绪复核全量接线
    dispatchDeps:
      remote === undefined
        ? (deps.dispatchDeps ?? {})
        : { ...(deps.dispatchDeps ?? {}), ...remoteHeadlessDeps(conn, remote) },
    ...(remote === undefined ? {} : { remote }),
    ...(supervisor === null ? {} : { petBridge: () => supervisor.currentBridge() }),
    ...(deps.helperPath === undefined ? {} : { helperPath: deps.helperPath }),
    ...(deps.sshFamily === undefined ? {} : { sshFamily: deps.sshFamily }),
    announceCaught: (variant) => stateFeed.announceCaught(variant),
    onPetLifecycle: () => stateFeed.pushSysConfig(),
  };
}

/** TimerApi 再出口（PluginDeps 文档锚点用） */
export type { TimerApi as LoopTimerApi };
