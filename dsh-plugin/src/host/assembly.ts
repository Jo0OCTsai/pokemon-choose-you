/**
 * 插件惰性装配工厂（AD §3.1 index 的 createPlugin 面）：storage 连接+迁移 →
 * health/logRing → tools 注册表 → host 命令表 → radio 轮询 → 自动派发循环 →
 * pet supervisor + stateFeed。全部依赖可注入（伪 ctx 集成测试消费同一工厂）；
 * 真实 dsh（Cordis）Context 的桥接留接口注释、不引 dsh 包。
 */
import { type Conn } from "./storage/db";
import { dbFileFrom } from "./storage/paths";
import { openAndInit } from "./storage/init";
import { LogRing } from "./health/logRing";
import { HealthState } from "./health/snapshot";
import { createPollLoop, realTimer, type PollLoop, type TimerApi } from "./radio/pollLoop";
import { createLark, type LarkCli } from "./radio/lark";
import { createTodoTools } from "./tools/todoTools";
import type { ToolRegistry } from "./tools/registry";
import {
  createChipDataSource,
  createHostCommands,
  type ChipDataSource,
  type HostCommandCaller,
  type HostCommandDeps,
} from "./commands";
import {
  startAutoDispatchLoop,
  systemTimer,
  type AutoDispatchLoop,
  type TimerApi as AutoTimer,
} from "./dispatch/autoDispatch";
import type { HeadlessDeps } from "./dispatch/headless";
import { createFakeTerminal, type TerminalAdapter } from "./dispatch/interactive";
import { cliJudgeExecutor, type JudgeExecutor } from "./judge/adapters";
import { primaryAgent } from "./domain/settings";
import { StateFeed, type FeedTimerApi } from "./pet/stateFeed";
import { PetSupervisor, memoryPetAutoStartStore, type HelperSpawner } from "./pet/supervisor";
import type { PageOpenPayload } from "./pet/cmdHandler";
import { assemblePet, type PluginSlots } from "./petSection";

/** 判定执行方工厂缺省实现：主 agent（收音机分类指定/首个启用）CLI 形态 */
function defaultJudgeExecutor(conn: Conn): JudgeExecutor | null {
  const agent = primaryAgent(conn);
  return agent === null ? null : cliJudgeExecutor({ conn, agent });
}

/** 插件装配依赖（全部可注入：伪 ctx 集成测试逐项替身；缺省 = 真实实现） */
export interface PluginDeps {
  /** 库文件路径（缺省 = CHOOSE_YOU_HOME / ~/.choose-you 归一化定位） */
  dbPath?: string;
  /** 收音机轮询 timer（setInterval 语义；测试注入手动触发） */
  pollTimer?: TimerApi;
  /** 自动派发 timer（every/cancel 语义） */
  autoTimer?: AutoTimer;
  /** 桌宠状态流 timer */
  feedTimer?: FeedTimerApi;
  /** helper spawner（不注入 = 桌宠不装配——petShow/petHide 报错） */
  petSpawner?: HelperSpawner;
  /** 「显示桌宠」开关（Config 双轨占位——内存实现，平台持久化归适配层，A2） */
  petAutoStart?: { get(): boolean; set(value: boolean): void };
  /** lark-cli 可执行（缺省 PATH 上的 lark-cli） */
  larkBin?: string;
  /** 判定执行方工厂（缺省 = 主 agent CLI；纯 dsh 冷启动无 agent 时 null） */
  newExecutor?: (conn: Conn) => JudgeExecutor | null;
  /** 无头派发依赖（执行器/worktree/ssh 预检——dsh 适配层注入） */
  dispatchDeps?: HeadlessDeps;
  /** 交互派发终端适配器（dsh terminal 表面；缺省 = fake 终端占位） */
  terminal?: TerminalAdapter;
  /** 支持报告元信息 */
  meta?: { pluginVersion?: string; dshVersion?: string | null };
  /** lark-cli 可执行存在性（diagnosticsSnapshot 的 feishuConfigured 位；缺省 true） */
  feishuConfigured?: boolean;
  /** 启动轮询（默认 true；纯命令面测试可关） */
  startPoll?: boolean;
}

/** 装配完成的插件实例（dsh 适配层与测试的消费面） */
export interface Plugin {
  conn: Conn;
  readonly migration: ReturnType<typeof openAndInit>["migration"];
  readonly tools: ToolRegistry;
  readonly commands: HostCommandCaller;
  readonly chip: ChipDataSource;
  readonly health: HealthState;
  readonly logs: LogRing;
  readonly poll: PollLoop;
  readonly stateFeed: StateFeed;
  readonly supervisor: PetSupervisor | null;
  /** host→客户端 pageOpen 推送订阅（桌宠双击/chip 点击经宿主导航打开插件页面） */
  onPageOpen(listener: (event: PageOpenPayload) => void): () => void;
  /** 生命周期收口：停循环 + 停 helper + 关连接 */
  dispose(): void;
}

/** 轮询/自动派发循环段装配（timer 全注入；启动即跑一轮轮询） */
function assembleLoops(
  conn: Conn,
  deps: PluginDeps,
  lark: LarkCli,
  health: HealthState,
  log: (l: "debug" | "info" | "warn" | "error", t: string, m: string) => void,
  newExecutor: (c: Conn) => JudgeExecutor | null,
  onWrites: () => void,
): { poll: PollLoop; auto: AutoDispatchLoop } {
  void onWrites;
  const poll = createPollLoop({
    conn,
    lark,
    health,
    newExecutor: () => newExecutor(conn),
    timer: deps.pollTimer ?? realTimer,
    log: (level, message) => log(level, "radio", message),
    onEvent: (event) => log("warn", "radio", `event: ${event}`),
  });
  const auto = startAutoDispatchLoop(conn, deps.dispatchDeps ?? {}, {
    timer: deps.autoTimer ?? systemTimer,
    onError: (error) => log("warn", "dispatch-auto", String(error)),
  });
  return { poll, auto };
}

/** host 命令依赖组装（缺省值兜底全部收拢在此——createPlugin 保持线性装配） */
function buildCommandDeps(args: {
  conn: Conn;
  deps: PluginDeps;
  health: HealthState;
  logs: LogRing;
  log: HostCommandDeps["log"];
  poll: PollLoop;
  lark: LarkCli;
  newExecutor: (c: Conn) => JudgeExecutor | null;
  supervisor: PetSupervisor | null;
  stateFeed: StateFeed;
  openPage: (section?: "panel" | "settings") => void;
}): HostCommandDeps {
  const { conn, deps } = args;
  return {
    conn,
    health: args.health,
    logs: args.logs,
    log: args.log,
    poll: { runRound: () => args.poll.runRound(), resume: () => args.poll.resume() },
    lark: args.lark,
    larkBin: deps.larkBin ?? "lark-cli",
    newExecutor: () => args.newExecutor(conn),
    dispatchDeps: deps.dispatchDeps ?? {},
    terminal: deps.terminal ?? createFakeTerminal(),
    pet: petFaceOf(args.supervisor),
    onWrites: () => args.stateFeed.notifyLocalWrite(),
    openPage: args.openPage,
    feishuConfigured: deps.feishuConfigured ?? true,
    meta: { pluginVersion: deps.meta?.pluginVersion ?? "0.1.0", dshVersion: deps.meta?.dshVersion ?? null },
  };
}

/** 桌宠生命周期面（未装配 = show 报错不静默；hide/running 空转） */
function petFaceOf(supervisor: PetSupervisor | null): HostCommandDeps["pet"] {
  return {
    show: async () => {
      if (supervisor === null) {
        throw new Error("桌宠 helper 未装配（petSpawner 未注入）");
      }
      return supervisor.show();
    },
    hide: () => supervisor?.hide(),
    get running() {
      return supervisor?.running ?? false;
    },
  };
}

/** 装配后的启动收尾（轮询启动 + 桌宠随宿主开关） */
function startExtras(plugin: Plugin, deps: PluginDeps, log: HostCommandDeps["log"]): void {
  if (deps.startPoll !== false) {
    plugin.poll.start();
  }
  const autoStart = deps.petAutoStart ?? memoryPetAutoStartStore();
  if (plugin.supervisor !== null && autoStart.get()) {
    void plugin.supervisor.show().catch((error: unknown) => {
      log("warn", "pet", `helper 拉起失败：${String(error)}`);
    });
  }
}

/** 装配插件（storage → health/log → pet/feed → loops → tools/commands → 启动收尾） */
export function createPlugin(deps: PluginDeps = {}): Plugin {
  const dbPath = deps.dbPath ?? dbFileFrom();
  if (dbPath === undefined) {
    throw new Error("[dsh-plugin] 无法定位待办库：CHOOSE_YOU_HOME 与 home 均不可用（AD §5.1 库定位）");
  }
  const { conn, migration } = openAndInit(dbPath);
  const logs = new LogRing();
  const health = new HealthState();
  const log = (level: "debug" | "info" | "warn" | "error", target: string, message: string): void => {
    logs.log(level, target, message, new Date().toISOString().replace("Z", "+00:00"));
  };
  const lark: LarkCli = createLark(deps.larkBin ?? "lark-cli");
  const newExecutor = deps.newExecutor ?? defaultJudgeExecutor;
  const slots: PluginSlots = { feed: null, supervisor: null };
  const openPageListeners = new Set<(event: PageOpenPayload) => void>();
  const openPage = (section?: "panel" | "settings"): void => openPageListeners.forEach((l) => l({ section }));
  const { supervisor, stateFeed } = assemblePet({ conn, deps, log, slots, openPage, health, newExecutor });
  const { poll, auto } = assembleLoops(conn, deps, lark, health, log, newExecutor, () => stateFeed.notifyLocalWrite());
  stateFeed.start();
  const commandDeps = buildCommandDeps({
    conn,
    deps,
    health,
    logs,
    log,
    poll,
    lark,
    newExecutor,
    supervisor,
    stateFeed,
    openPage,
  });
  const plugin = buildPluginObject({
    conn,
    migration,
    commandDeps,
    health,
    logs,
    poll,
    stateFeed,
    supervisor,
    openPageListeners,
    auto,
  });
  startExtras(plugin, deps, log);
  return plugin;
}

/** Plugin 实例组装（对象面；dispose 收口清单集中在此） */
function buildPluginObject(args: {
  conn: Conn;
  migration: Plugin["migration"];
  commandDeps: HostCommandDeps;
  health: HealthState;
  logs: LogRing;
  poll: PollLoop;
  stateFeed: StateFeed;
  supervisor: PetSupervisor | null;
  openPageListeners: Set<(event: PageOpenPayload) => void>;
  auto: AutoDispatchLoop;
}): Plugin {
  return {
    conn: args.conn,
    migration: args.migration,
    tools: createTodoTools(),
    commands: createHostCommands(args.commandDeps),
    chip: createChipDataSource({ conn: args.conn }),
    health: args.health,
    logs: args.logs,
    poll: args.poll,
    stateFeed: args.stateFeed,
    supervisor: args.supervisor,
    onPageOpen(listener) {
      args.openPageListeners.add(listener);
      return () => {
        args.openPageListeners.delete(listener);
      };
    },
    dispose() {
      args.poll.stop();
      args.auto.stop();
      args.stateFeed.stop();
      args.supervisor?.dispose();
      args.conn.close();
    },
  };
}
