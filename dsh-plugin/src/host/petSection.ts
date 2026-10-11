/**
 * 插件装配的桌宠段（从 assembly.ts 拆出以控复杂度棘轮口径）：supervisor（桥上行
 * cmd/focus-settle 分发）+ stateFeed（下行快照流 + 写后直推）。
 */
import type { Conn } from "./storage/db";
import { captureTodo } from "./judge/capture";
import type { JudgeExecutor } from "./judge/adapters";
import type { HealthState } from "./health/snapshot";
import { StateFeed, feedSystemTimer, getPetPos } from "./pet/stateFeed";
import { PetSupervisor, type PetSupervisorOptions } from "./pet/supervisor";
import { handleCmd, handleFocusSettle } from "./pet/cmdHandler";
import type { PluginDeps } from "./assembly";

/** 交叉引用槽（supervisor 处理器 ↔ stateFeed/supervisor 互引的装配期载体） */
export interface PluginSlots {
  feed: StateFeed | null;
  supervisor: PetSupervisor | null;
}

/** 桥上行处理器（cmd/focus-settle → domain + 装配回调；AD §4.3） */
export function petHandlers(args: {
  conn: Conn;
  health: HealthState;
  log: (l: "debug" | "info" | "warn" | "error", t: string, m: string) => void;
  slots: PluginSlots;
  openPage: (section?: "panel" | "settings") => void;
  newExecutor: (c: Conn) => JudgeExecutor | null;
}): PetSupervisorOptions["handlers"] {
  return {
    onCmd: (msg) => {
      handleCmd(
        {
          conn: args.conn,
          onOpenPage: (payload) => args.openPage(payload.section),
          onCapture: (text) => {
            const executor = args.newExecutor(args.conn);
            if (executor === null) {
              args.log("warn", "pet:capture", "未配置 AI agent，捕捉丢弃");
              return;
            }
            void captureTodo({ conn: args.conn, executor, health: args.health }, text).catch((error: unknown) => {
              args.log("warn", "pet:capture", String(error));
            });
          },
          onHide: () => args.slots.supervisor?.hide(),
          onWrites: () => args.slots.feed?.notifyLocalWrite(),
        },
        msg,
      );
    },
    onFocusSettle: (msg) => {
      handleFocusSettle(args.conn, msg);
      args.slots.feed?.notifyLocalWrite();
    },
  };
}

/** 桌宠段装配：supervisor（桥上行分发）+ stateFeed（下行快照流） */
export function assemblePet(args: {
  conn: Conn;
  deps: PluginDeps;
  log: (l: "debug" | "info" | "warn" | "error", t: string, m: string) => void;
  slots: PluginSlots;
  openPage: (section?: "panel" | "settings") => void;
  health: HealthState;
  newExecutor: (c: Conn) => JudgeExecutor | null;
}): { supervisor: PetSupervisor | null; stateFeed: StateFeed } {
  const { conn, deps, log, slots, openPage, health, newExecutor } = args;
  const supervisor =
    deps.petSpawner === undefined
      ? null
      : new PetSupervisor({
          spawner: deps.petSpawner,
          getPos: () => getPetPos(conn),
          onBridgeReady: () => slots.feed?.republishAll(),
          handlers: petHandlers({ conn, health, log, slots, openPage, newExecutor }),
        });
  slots.supervisor = supervisor;
  const stateFeed = new StateFeed(conn, {
    timer: deps.feedTimer ?? feedSystemTimer,
    bridgeProvider: () => slots.supervisor?.currentBridge() ?? null,
  });
  slots.feed = stateFeed;
  return { supervisor, stateFeed };
}
