/**
 * dsh（DeepSeek Harness）宿主插件入口（平台胶水层，Phase A host 半边真实适配）。  形态（dsh 0.2.1-rc.2 插件清单）：本包经 `dsh plugin --profile <name> add file:…` 作为自注册 bundle 安装（包内 cordis.patch.yml insert 本 entry），loader 读 package.json main（dist/host.js）加载本模块，消费具名导出 name/inject/Config/apply。  职责边界：本层只做平台接线——能力探测、createPlugin 依赖注入（timer/pet spawner/ 判定执行方）、22 工具 → ctx.tools（defineTool JSON DSL 投影）、69 host 命令 → connection 共享 /api 通道 `
 */
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import z from "@deepseek-ai/schemastery";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/cordis-plugin-timer"; // 类型面：ctx.interval/ctx.timeout 增强
import type {} from "@deepseek-ai/dsh-client-connection"; // 类型面：Context.connection 增强
import { createPlugin, defaultJudgeExecutor, probeNodeSqlite, unsupportedSqliteError, type Plugin } from "../index";
import { createHandoffTerminal } from "../dispatch/terminalAdapters";
import { detectExternalTerminal, isDesktopCarrier } from "./externalTerminal";
import { createExternalTerminalAdapter, externalTerminalLine } from "./externalTerminalAdapter";
import { ensureElectronDist } from "../pet/electronGet";
import { electronSpawner } from "../pet/supervisor";
import { dbFileFrom } from "../storage/paths";
import { registerEmbeddedSchemas } from "../storage/migrate";
import schemaRaw from "../storage/schema-raw";
import { dshSessionExecutorOf } from "./sessionExecutor";
import type { HelperSpawner } from "../pet/supervisor";
import type { TimerApi as LoopTimer } from "../dispatch/autoDispatch";
import { registerTodoTools } from "./toolRegister";
import { PkyRemoteService } from "./remoteService";
import { remotePlatformOf, wireRemoteGuard, type RemoteAssembly } from "./remoteAssembly";
import { listDeployments } from "../remote/deployments";
import { pkSetupOf } from "./pkSetup";
import { TunnelSupervisor } from "../remote/tunnelSupervisor";

// 契约 SQL 编译期内嵌注册（migrate 双 loader 的内嵌侧）：安装形态磁盘相对路径不可达，
// dist 产物经 build.mjs 的 ?raw loader 内嵌——模块加载期注册一次（fs 回落留给仓内 dev 直跑）
registerEmbeddedSchemas({ ...schemaRaw });

// 远程派发适配面（任务 2.1/2.2 产出；接线归任务 2.9）：此处仅再出口使模块进构建图——
// 保持 `import("@deepseek-ai/dsh-ssh")` 动态字面量落进 dist（external 口径，运行时从
// 插件包闭包解析——spike 验证点③）；不改变 apply 行为（惰性装载语义不变）
export { createSshScopeHost, type CordisHostContext, type SshScopeHost } from "./sshScope";
export { DSH_CAPABILITY_KEYS, probeDshCapabilities, sshFamilyOf } from "./probeDsh";

/** 入口 id（cordis.patch.yml 的 insert id 同名；包名 pokemon-choose-you-dsh 是安装定位面） */
export const name = "pokemon-choose-you";

/** 必需服务（timer 需 inject；agents/sessions/agentDefaultModel = 内置判定通道消费面——
 *  dsh-base 恒在场，缺席则插件不装（fail fast）） */
export const inject = ["tools", "timer", "agents", "sessions", "agentDefaultModel"];

/**
 * 插件 Config（schemastery；A2 Config 双轨最小集）。
 * volatile = live 表单字段（设置面改值即时生效，读值走 .get()——本层只在装配期读一次）。
 */
export const Config = z.object({
  petAutoStart: z
    .boolean()
    .default(true)
    .volatile()
    .description("随宿主启动显示桌宠（helper/electron 就绪才生效；未就绪自动降级停用）"),
  judgeExecutor: z
    .union(["session", "subagent", "cli"])
    // root 会话形态（2026-10-19 裁决）：默认 session（一批一会话，进主会话列表可回放）；
    // subagent = 旧存量值别名（同走内置通道，仅避免宿主已存配置校验失败）；cli = 外部 agent CLI 子进程
    .default("session")
    .volatile()
    .description(
      "判定执行方：session = dsh 内置通道（root 会话一批一会话，可回放；旧值 subagent 等价）；cli = 外部 agent CLI 子进程",
    ),
});

/** loader 解析后的 config 形态（volatile 字段为 { get() } 引用；兼容普通值便于测试） */
export interface ResolvedPkyConfig {
  petAutoStart: { get(): boolean } | boolean;
  judgeExecutor: { get(): "session" | "subagent" | "cli" } | "session" | "subagent" | "cli";
}

/** volatile/普通值兼容读取（live 表单改值经 .get() 生效） */
function readSetting<T>(field: { get(): T } | T): T {
  return typeof field === "object" && field !== null && typeof (field as { get?: unknown }).get === "function"
    ? (field as { get(): T }).get()
    : (field as T);
}

/** 交互终端装配：desktop 载体 → 外部终端适配器（按次解析偏好→探测链；唤起失败/无终端内部回落 handoff）；web 载体 → handoff + web-carrier 原因码 */
function externalTerminal装配() {
  if (isDesktopCarrier()) {
    return createExternalTerminalAdapter();
  }
  return createHandoffTerminal("dsh web 载体：终端窗口会开在宿主机器的屏幕上", "web-carrier");
}

/** createPlugin 依赖注入面（timer/桌宠 spawner/判定执行方/远程平台——接线单源） */
function pluginDepsOf(
  ctx: Context,
  config: ResolvedPkyConfig,
  dbPath: string,
  petSpawner: HelperSpawner | undefined,
  remote: RemoteAssembly,
  tunnels: NonNullable<Parameters<typeof createPlugin>[0]>["tunnels"],
  pkSetup: NonNullable<Parameters<typeof createPlugin>[0]>["pkSetup"],
): Parameters<typeof createPlugin>[0] {
  return {
    dbPath,
    pollTimer: (cb, ms) => ctx.interval(cb, ms),
    autoTimer: loopTimerOf(ctx),
    feedTimer: loopTimerOf(ctx),
    reminderTimer: (cb, ms) => ctx.interval(cb, ms),
    backupTimer: (cb, ms) => ctx.interval(cb, ms),
    petSpawner,
    helperPath: () => locateHelperMain() ?? "",
    remote: remote.platform,
    sshFamily: () => remote.familyProjection(),
    // 常驻隧道服务面（deploymentList 状态行 + 部署写 resync）与 pk 通道开通执行器
    tunnels,
    pkSetup,
    petAutoStart: {
      // D18「随 dsh 启动」默认开：宿主配置面未显式写 false 时视为开（schemastery
      // default(true) 在 dsh 配置面未落值时不生效——真机冒烟实测，未设值 = undefined）
      get: () => readSetting(config.petAutoStart) !== false,
      set: () => undefined, // 平台持久化归 dsh 配置面（Phase B 客户端设置段写回）
    },
    // 判定执行方（volatile 活读——背包改值热应用后下一次判定即生效）：cli = 业务核心缺省
    // （主 agent CLI 子进程）；session/subagent（旧值别名）= dsh 内置通道
    // （dsh/sessionExecutor.ts，root 会话一批一会话，默认）。
    // newExecutor 每次判定调用（pollLoop / 命令面），活闭包按当前配置值路由
    newExecutor: (conn) =>
      readSetting(config.judgeExecutor) === "cli" ? defaultJudgeExecutor(conn) : dshSessionExecutorOf(ctx),
    // dispatchDeps/larkBin 缺省：lark-cli 走 PATH；无头派发 executorFor 缺省走 local 子进程。
    // 交互终端/terminalLine（debt ③ a desktop 载体解 + 终端偏好遵循）：dsh 桌面 app
    // （Electron 宿主）→ 适配器按次解析（共享设置 terminal_preference 命中优先，探测链
    // Ghostty → kitty → … → iTerm2 → Terminal.app 回落；唤起失败自动回落 copy-line
    // handoff）；web/headless CLI 载体 → 无窗口可弹（远程浏览器看不见宿主屏幕），handoff
    // 命令行回传 + 客户端 web 提示。远端交互不经本件（remoteInteractiveParts 真 PTY/
    // copy-line，装配层接线）。
    terminal: externalTerminal装配(),
    // 回放/lark 登录的终端行注入（desktop 载体 → 外部终端真窗口，injectLineGuarded 统一
    // 读偏好随行注入；web 载体缺省——回放自动走 handoff 命令行回传，lark 登录 note 携带命令行）
    ...(isDesktopCarrier() && detectExternalTerminal() !== null ? { terminalLine: externalTerminalLine() } : {}),
  };
}

/** 桌宠降级面收口（A20）：helper 产物在而 electron 缺失 → 后台按需获取 + 降级明示 */
function degradePetRuntime(plugin: Plugin, petSpawner: HelperSpawner | undefined): void {
  if (petSpawner !== undefined) {
    return;
  }
  if (locateHelperMain() === undefined) {
    warnDegrade(plugin, "桌宠降级停用（A20）：未定位到 helper/dist/main.js（插件包分发面缺件）");
    return;
  }
  // D30：helper 产物在、electron 二进制缺失 → electronGet 后台按需获取（NFR-15：下载不阻塞
  // 冷启动——本次会话降级明示，落位 ~/.dsh/electron/dist/ 即被探测链命中，下次启动恢复）
  void ensureElectronDist().then(
    (result) => {
      if (result.status === "failed") {
        warnDegrade(plugin, `electron 运行时获取失败：${result.reason}——手动放置指引：${result.guidance}`);
      } else {
        warnDegrade(plugin, `electron 运行时已就绪（${result.binPath}）——本次为下载期降级，下次启动桌宠自动恢复`);
      }
    },
    (error) => warnDegrade(plugin, `electron 运行时获取异常：${String(error)}`),
  );
  warnDegrade(
    plugin,
    "桌宠降级停用（A20）：electron 二进制缺失——已发起后台按需获取（~/.dsh/electron/dist/），就绪后下次启动生效",
  );
}

/**
 * 插件 apply：能力探测（node:sqlite 硬拒绝——NFR-3 不静默半工作）→ createPlugin 真实
 * 装配 → 工具/RPC 注册（全部挂 ctx.effect，fiber 卸载逆序注销）。
 */
export function apply(ctx: Context, config: ResolvedPkyConfig): void {
  const capability = probeNodeSqlite();
  if (!capability.ok) {
    throw unsupportedSqliteError(capability);
  }
  const dbPath = dbFileFrom();
  if (dbPath === undefined) {
    throw new Error("[pokemon-choose-you] 无法定位待办库：CHOOSE_YOU_HOME 与 home 均不可用（AD §5.1 库定位）");
  }
  process.stderr.write(`[pokemon-choose-you] 待办库：${dbPath}\n`);
  const petSpawner = detectPetSpawner();
  // 远程部署平台面（full-parity 2.9）：scope 宿主 + 家族探测投影 + 闭包 helper 制品
  const remote = remotePlatformOf(ctx);
  // 常驻隧道（ADR-0003 §2）：任一宿主驻留期维持——让位锁与桌面 app 协调（同锁协议）。
  // 服务先以惰性闭包注入命令面（resync 目标连接在插件就绪后绑定），再按注册表同步
  const tunnels = new TunnelSupervisor();
  let resyncFromRegistry: () => void = () => undefined;
  const tunnelsService = {
    resync: () => resyncFromRegistry(),
    statusOf: (id: string) => tunnels.statusOf(id),
  };
  const plugin = createPlugin(pluginDepsOf(ctx, config, dbPath, petSpawner, remote, tunnelsService, pkSetupOf()));
  try {
    wireRemoteGuard(ctx, plugin, remote);
    resyncFromRegistry = () => tunnels.sync(Object.values(listDeployments(plugin.conn)));
    ctx.effect(() => () => tunnels.stopAll());
    resyncFromRegistry();
    degradePetRuntime(plugin, petSpawner);
  } catch (error) {
    // createPlugin 已启动轮询等常驻件而 plugin.dispose 尚未挂 effect——装配失败须先收口
    // 再上抛；否则在途循环会在已销毁 fiber 上重注册 timer，INACTIVE_EFFECT 掩盖真实错误并崩宿主
    plugin.dispose();
    throw error;
  }
  // 装配逆序注册：dispose 最先进 effect → 卸载时最后执行（先注销工具/RPC，再收口循环与连接）
  ctx.effect((): (() => void) => plugin.dispose);
  try {
    registerTodoTools(ctx, plugin);
    new PkyRemoteService(ctx, plugin.commands);
  } catch (error) {
    process.stderr.write(
      `[pokemon-choose-you] 工具/RPC 注册失败：${String(error)}\n${error instanceof Error ? error.stack : ""}\n`,
    );
    throw error;
  }
}

// ---- 远程部署平台面装配（full-parity 2.9）：platform/断连守卫/家族探测拆在
// remoteAssembly.ts（控本文件行数棘轮）；此处再出口使装配件进构建图

/** 循环 timer 面（autoDispatch 与 stateFeed 同形：every/cancel → ctx.interval 反注册函数） */
function loopTimerOf(ctx: Context): LoopTimer {
  return {
    every: (ms, fn) => ctx.interval(fn, ms),
    cancel: (handle) => (handle as () => void)(),
  };
}

// ---- 桌宠 helper 拉起面（spawner 定位 + electron 探测；找不到 = 降级停用不报错 A20） ----

/**
 * 定位桌宠 spawner：helper 主产物（helper/dist/main.js）+ electron **真实二进制**。 探测链（注释即探测顺序单源）： helper 主产物：从本模块目录逐级向上（仓内 dev：src/host/dsh → 包根；构建产物：dist → 包根； profile 安装：node_modules/dsh-plugin/dist → 包根——file: 安装带 helper/ 才有） electron：node_modules/electron/dist/ 下的平台二进制（helper 子包 devDep → 插件包根 → 仓库根，跟随 symlink 可达 pnpm store 真实位） → ~/.dsh/electron/（dsh-pet 先例的运行时下载位：electron / bin/electron / dist/Electron.app/C
 */
function detectPetSpawner(): HelperSpawner | undefined {
  const helperMain = locateHelperMain();
  if (helperMain === undefined) {
    return undefined;
  }
  const helperDir = dirname(helperMain);
  const electronBin = locateElectronBinary(helperDir);
  if (electronBin === undefined) {
    return undefined;
  }
  return electronSpawner(electronBin, helperMain);
}

/** 向上探测 helper/dist/main.js（上限 5 级；命中即返回绝对路径） */
function locateHelperMain(): string | undefined {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "helper", "dist", "main.js");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return undefined;
}

/** electron 平台二进制相对 dist 位：darwin = Electron.app 包内执行档；win32 = electron.exe；
 * 其余 = 平铺 electron（electronGet 落位产物同名——落位即被探测，full-parity AD §3.4） */
function electronDistBin(): string {
  if (process.platform === "darwin") return join("Electron.app", "Contents", "MacOS", "Electron");
  return process.platform === "win32" ? "electron.exe" : "electron";
}

/** electron 二进制候选定位（真实二进制，顺序见 detectPetSpawner 注释；全部 miss = undefined） */
function locateElectronBinary(helperDir: string): string | undefined {
  const pluginRoot = dirname(helperDir);
  const home = homedir();
  const distBin = electronDistBin();
  const candidates = [
    join(helperDir, "node_modules", "electron", "dist", distBin),
    join(pluginRoot, "node_modules", "electron", "dist", distBin),
    join(pluginRoot, "..", "node_modules", "electron", "dist", distBin),
    join(home, ".dsh", "electron", "electron"),
    join(home, ".dsh", "electron", "bin", "electron"),
    join(home, ".dsh", "electron", "dist", distBin),
  ];
  return candidates.find((candidate) => isRegularFile(candidate));
}

function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** 降级告警双出口：插件内日志环（logQuery 可查）+ stderr（宿主启动期可见） */
function warnDegrade(plugin: Plugin, message: string): void {
  plugin.logs.log("warn", "dsh", message, new Date().toISOString().replace("Z", "+00:00"));
  process.stderr.write(`[pokemon-choose-you] ${message}\n`);
}
