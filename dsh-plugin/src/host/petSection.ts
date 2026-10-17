/**
 * 插件装配的桌宠段（从 assembly.ts 拆出以控复杂度棘轮口径）：supervisor（桥上行
 * cmd/focus-settle 分发）+ stateFeed（下行快照流 + 写后直推）。
 * full-parity 2.7 接线：pet done 路径郑重时刻判定（A30——完成动作发生在本形态）+
 * pet-chat 主 agent 执行方（FR-A8——任务快照假名化入上下文，回答经 chat-reply 回送）。
 */
import type { Conn } from "./storage/db";
import { captureTodo } from "./judge/capture";
import type { JudgeExecutor } from "./judge/adapters";
import type { HealthState } from "./health/snapshot";
import { primaryAgent } from "./domain/settings";
import { StateFeed, feedSystemTimer, getPetPos } from "./pet/stateFeed";
import { PetSupervisor, type PetSupervisorOptions } from "./pet/supervisor";
import { handleCmd, handleFocusSettle } from "./pet/cmdHandler";
import { celebrateSolemn, caughtVariantOf, dexDoneCount } from "./pet/solemn";
import { runPetChat } from "./pet/petChat";
import { makeSysEventHandlers } from "./pet/sysEvents";
import type { BridgeClient } from "./pet/bridge";
import type { PluginDeps } from "./assembly";

/** 交叉引用槽（supervisor 处理器 ↔ stateFeed/supervisor 互引的装配期载体） */
export interface PluginSlots {
  feed: StateFeed | null;
  supervisor: PetSupervisor | null;
}

/** petHandlers 装配参数面（模块级类型——拆小函数共用） */
interface PetHandlerArgs {
  conn: Conn;
  health: HealthState;
  log: (l: "debug" | "info" | "warn" | "error", t: string, m: string) => void;
  slots: PluginSlots;
  openPage: (section?: "panel" | "settings", focus?: "capture") => void;
  newExecutor: (c: Conn) => JudgeExecutor | null;
}

/** cmd 上行的 domain 依赖组装（捕捉/显隐/写后直推/聊聊——onCmd 消费） */
function petCmdDepsOf(args: PetHandlerArgs, petBridge: () => BridgeClient | null) {
  return {
    conn: args.conn,
    onOpenPage: (payload: { section?: "panel" | "settings" }) => args.openPage(payload.section),
    onCapture: (text: string) => {
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
    onPetChat: (text: string) => {
      const agent = primaryAgent(args.conn);
      if (agent === null) {
        args.log("warn", "pet:chat", "未配置 AI agent，聊聊回退");
        petBridge()?.sys.sendChatReply("（还没配置 AI agent，先到设置里配一个吧）", false);
        return;
      }
      void runPetChat({ conn: args.conn, agent, bridge: petBridge }, text);
    },
  };
}

/** sys 事件六种处理器（2.6 产物装配接线）：托盘/快捷键 → pageOpen 链 + 显隐生命周期；
 * input-activity 内存透传；mac-auth 主动变更与 sys-unsupported 记诊断 */
function sysEventHandlersOf(args: PetHandlerArgs) {
  return makeSysEventHandlers({
    openPage: (payload) => args.openPage(payload.section, payload.focus),
    petShow: () => {
      void args.slots.supervisor?.show().catch(() => undefined);
    },
    petHide: () => args.slots.supervisor?.hide(),
    petVisible: () => args.slots.supervisor?.running ?? false,
    onNotifyClicked: () => undefined,
    onSysUnsupported: (msg) => args.log("warn", "pet:sys", `能力位与实现失配：${msg.type}（提示升级 helper）`),
    onMacAuthChange: (msg) =>
      args.log("info", "pet:mac-auth", msg.granted ? "辅助功能授权已恢复" : "辅助功能授权已撤销（输入计数停止）"),
  });
}

/** 桥上行处理器（cmd/focus-settle + sys 事件 → domain + 装配回调；AD §4.3） */
export function petHandlers(args: PetHandlerArgs): PetSupervisorOptions["handlers"] {
  const petBridge = () => args.slots.supervisor?.currentBridge() ?? null;
  return {
    onCmd: (msg) => {
      // done 路径郑重时刻（A30）：完成动作发生在本形态 → 前后图鉴计数喂 milestone 判定；
      // 判定命中随 task-state.caught 变体直推（A1——helper CatchShow 消费）
      const celebrate = msg.op === "done";
      const before = celebrate ? dexDoneCount(args.conn) : 0;
      handleCmd(petCmdDepsOf(args, petBridge), msg);
      if (celebrate) {
        const solemn = celebrateSolemn(args.conn, petBridge, { before, after: dexDoneCount(args.conn) });
        if (solemn !== null) {
          args.slots.feed?.announceCaught(caughtVariantOf(solemn));
        }
      }
    },
    onFocusSettle: (msg) => {
      handleFocusSettle(args.conn, msg);
      args.slots.feed?.notifyLocalWrite();
    },
    ...sysEventHandlersOf(args),
  };
}

/** 桌宠段装配：supervisor（桥上行分发）+ stateFeed（下行快照流 + sys-config 投影） */
export function assemblePet(args: {
  conn: Conn;
  deps: PluginDeps;
  log: (l: "debug" | "info" | "warn" | "error", t: string, m: string) => void;
  slots: PluginSlots;
  openPage: (section?: "panel" | "settings", focus?: "capture") => void;
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
    // tray.petVisible 投影（A3）：supervisor 显隐状态回传（托盘 label 同步）
    petVisible: () => slots.supervisor?.running ?? false,
  });
  slots.feed = stateFeed;
  return { supervisor, stateFeed };
}
