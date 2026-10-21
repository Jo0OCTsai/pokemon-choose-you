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
import { createLogSink, pluginLogger } from "./health/fileLogSink";
import { HealthState } from "./health/snapshot";
import { type PollLoop, type TimerApi } from "./radio/pollLoop";
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
import { type AutoDispatchLoop, type TimerApi as AutoTimer } from "./dispatch/autoDispatch";
import type { HeadlessDeps } from "./dispatch/headless";
import { createFakeTerminal } from "./dispatch/terminalAdapters";
import type { TerminalAdapter } from "./dispatch/interactive";
import type { TerminalLineInjector } from "./commands/context";
import { defaultJudgeExecutor, type JudgeExecutor } from "./judge/adapters";
import type { AgentEnvProvider } from "./dispatch/localEnv";
import { StateFeed, type FeedTimerApi } from "./pet/stateFeed";
import { PetSupervisor, memoryPetAutoStartStore, type HelperSpawner } from "./pet/supervisor";
import type { PageOpenPayload } from "./pet/cmdHandler";
import { assemblePet, type PluginSlots } from "./petSection";
import { PomoStateStore } from "./pet/pomoState";
import { assembleLoopsFull, assemblePollLoops, parityCommandDeps } from "./loopSection";
import type { RemoteCommandPlatform } from "./commands";
import type { SshFamilyProjection } from "./dsh/probeDsh";
import type { ReminderLoop } from "./reminder/loop";
import { ReminderDelivery } from "./reminder/deliver";
import type { DailyBackupOutcome } from "./domain/backup-loop";

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
  /** agent 子进程凭据环境（dsh 形态 DEEPSEEK_API_KEY 注入；缺省不注入——localEnv.AgentEnvProvider） */
  agentEnv?: AgentEnvProvider;
  /** 交互派发终端适配器（dsh terminal 表面；缺省 = fake 终端占位——真实宿主注入外部终端/handoff） */
  terminal?: TerminalAdapter;
  /** 终端行注入面（回放本机分支/lark 登录；dsh 适配层注入外部终端行注入件） */
  terminalLine?: TerminalLineInjector;
  remoteSshWindow?: TerminalAdapter; // 部署路由交互的本机 ssh 弹窗终端（探测到 GUI 终端时注入；缺省远端 PTY/copy-line 链）
  /** 支持报告元信息 */
  meta?: { pluginVersion?: string; dshVersion?: string | null };
  /** lark-cli 可执行存在性（diagnosticsSnapshot 的 feishuConfigured 位；缺省 true） */
  feishuConfigured?: boolean;
  /** 启动轮询（默认 true；纯命令面测试可关） */
  startPoll?: boolean;
  // ---- full-parity 2.7/2.9 增量装配面 ----
  /** 提醒循环 timer（20s tick；缺省 setInterval） */
  reminderTimer?: TimerApi;
  /** 备份循环 timer（30min tick；缺省 setInterval） */
  backupTimer?: TimerApi;
  /** 远程部署平台面（deployment、provision 族命令与远程派发路由；缺省 = 远端能力降级不装配） */
  remote?: RemoteCommandPlatform;
  /** 常驻隧道服务（ADR-0003 双宿主让位 supervisor；dsh 适配层注入，缺省隧道不维持） */
  tunnels?: HostCommandDeps["tunnels"];
  /** pk 通道开通执行器（`pk remote setup` spawn + 本机 pk 落位；缺省命令降级拒绝） */
  pkSetup?: HostCommandDeps["pkSetup"];
  /** dsh-ssh 家族探测投影（diagnosticsSnapshot.sshFamily 数据源；缺省 null 不显行） */
  sshFamily?: () => SshFamilyProjection | null;
  /** helper 入口路径（macAuthorizationStatus 回显；缺省空串） */
  helperPath?: () => string;
  /** 日志落盘目录（缺省 = <appHome>/logs 定位；null = 关闭落盘仅内存环——测试注入） */
  logDir?: string | null;
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
  /** 统一日志面（内存环 + FileLogSink 落盘——ADR-0005；落盘失败回环 warn） */
  readonly log: HostCommandDeps["log"];
  readonly poll: PollLoop;
  readonly stateFeed: StateFeed;
  readonly supervisor: PetSupervisor | null;
  /** 提醒循环（20s tick；runTick 供测试/手动单轮） */
  readonly reminder: ReminderLoop;
  /** 提醒送达通道（降级/丢弃计数——诊断面） */
  readonly reminderDelivery: ReminderDelivery;
  /** 每日备份循环（30min tick；runOnce 供测试/手动单轮） */
  readonly backupLoop: { stop(): void; runOnce(): DailyBackupOutcome };
  /** host→客户端 pageOpen 推送订阅（桌宠双击/chip 点击经宿主导航打开插件页面） */
  onPageOpen(listener: (event: PageOpenPayload) => void): () => void;
  /** 生命周期收口：停循环 + 停 helper + 关连接 */
  dispose(): void;
}

/** host 命令依赖组装（缺省值兜底全部收拢在此——createPlugin 保持线性装配；
 *  full-parity 可选面在 loopSection.parityCommandDeps） */
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
  pomo: PomoStateStore;
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
    terminal: deps.terminal ?? createFakeTerminal(),
    ...(deps.terminalLine === undefined ? {} : { terminalLine: deps.terminalLine }),
    pet: petFaceOf(args.supervisor, args.pomo),
    onWrites: () => args.stateFeed.notifyLocalWrite(),
    openPage: args.openPage,
    feishuConfigured: deps.feishuConfigured ?? true,
    meta: { pluginVersion: deps.meta?.pluginVersion ?? "0.1.0", dshVersion: deps.meta?.dshVersion ?? null },
    // ---- full-parity 2.7/2.9 增量面（可选注入，缺省按能力缺失降级） ----
    ...parityCommandDeps({ conn, deps, supervisor: args.supervisor, stateFeed: args.stateFeed }),
  };
}

/** 桌宠生命周期面（未装配 = show 报错不静默；hide/running 空转；相位只在 helper 运行中有效） */
function petFaceOf(supervisor: PetSupervisor | null, pomo: PomoStateStore): HostCommandDeps["pet"] {
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
    pomodoro: () => (supervisor?.running === true ? pomo.view() : null),
  };
}

/** 装配后的启动收尾（轮询启动 + 提醒/备份循环 + 桌宠随宿主开关） */
function startExtras(plugin: Plugin, deps: PluginDeps, log: HostCommandDeps["log"]): void {
  if (deps.startPoll !== false) {
    plugin.poll.start();
    plugin.reminder.start();
  }
  const autoStart = deps.petAutoStart ?? memoryPetAutoStartStore();
  if (plugin.supervisor !== null && autoStart.get()) {
    void plugin.supervisor.show().catch((error: unknown) => {
      log("warn", "pet", `helper 拉起失败：${String(error)}`);
    });
  }
}

/** openPage 广播器（section/focus 事件 → 已注册监听器集合逐一转发） */
function pageOpener(
  listeners: Set<(event: PageOpenPayload) => void>,
): (section?: "panel" | "settings", focus?: "capture") => void {
  return (section, focus) => {
    listeners.forEach((l) => l({ section, ...(focus !== undefined ? { focus } : {}) }));
  };
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
  const log = pluginLogger(logs, createLogSink(deps.logDir));
  const lark: LarkCli = createLark(deps.larkBin ?? "lark-cli");
  const newExecutor = deps.newExecutor ?? ((conn: Conn) => defaultJudgeExecutor(conn, deps.agentEnv));
  const slots: PluginSlots = { feed: null, supervisor: null, pomo: new PomoStateStore() };
  const openPageListeners = new Set<(event: PageOpenPayload) => void>();
  const openPage = pageOpener(openPageListeners);
  const { supervisor, stateFeed } = assemblePet({ conn, deps, log, slots, openPage, health, newExecutor });
  const { poll, auto } = assemblePollLoops({ conn, deps, lark, health, log, newExecutor, feed: stateFeed });
  const { reminder, reminderDelivery, backupLoop } = assembleLoopsFull({ conn, deps, supervisor, log, stateFeed });
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
    pomo: slots.pomo,
    openPage,
  });
  const plugin = buildPluginObject({
    conn,
    migration,
    commandDeps,
    health,
    logs,
    log,
    poll,
    stateFeed,
    supervisor,
    openPageListeners,
    auto,
    reminder,
    reminderDelivery,
    backupLoop,
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
  log: HostCommandDeps["log"];
  poll: PollLoop;
  stateFeed: StateFeed;
  supervisor: PetSupervisor | null;
  openPageListeners: Set<(event: PageOpenPayload) => void>;
  auto: AutoDispatchLoop;
  reminder: ReminderLoop;
  reminderDelivery: ReminderDelivery;
  backupLoop: { stop(): void; runOnce(): DailyBackupOutcome };
}): Plugin {
  return {
    conn: args.conn,
    migration: args.migration,
    tools: createTodoTools(),
    commands: createHostCommands(args.commandDeps),
    chip: createChipDataSource({ conn: args.conn }),
    health: args.health,
    logs: args.logs,
    log: args.log,
    poll: args.poll,
    stateFeed: args.stateFeed,
    supervisor: args.supervisor,
    reminder: args.reminder,
    reminderDelivery: args.reminderDelivery,
    backupLoop: args.backupLoop,
    onPageOpen(listener) {
      args.openPageListeners.add(listener);
      return () => {
        args.openPageListeners.delete(listener);
      };
    },
    dispose() {
      args.poll.stop();
      args.auto.stop();
      args.reminder.stop();
      args.backupLoop.stop();
      args.stateFeed.stop();
      args.supervisor?.dispose();
      args.conn.close();
    },
  };
}
