/**
 * dsh（DeepSeek Harness）宿主插件入口（平台胶水层，Phase A host 半边真实适配）。
 *
 * 形态（dsh 0.2.0-rc.2 插件清单）：本包经 `dsh plugin --profile <name> add file:…`
 * 作为自注册 bundle 安装（包内 cordis.patch.yml insert 本 entry），loader 读
 * package.json main（dist/host.js）加载本模块，消费具名导出 name/inject/Config/apply。
 *
 * 职责边界：本层只做平台接线——能力探测、createPlugin 依赖注入（timer/pet spawner/
 * 判定执行方）、22 工具 → ctx.tools（defineTool JSON DSL 投影）、69 host 命令 →
 * connection 共享 /api 通道 `pky/<command>` 端点；业务行为全部在 src/host/** 业务核心。
 *
 * 数据面：69 host 命令经 PkyRemoteService（Typert Remote，官方 /api 通道——
 * 2026-10-13 迁移，原 connection.rpc.handle 自定义通道在 rc.2 对第三方不可用）；
 * 服务注册即生效，headless 组合同样安全（无 connection 依赖）。
 */
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import z from "@deepseek-ai/schemastery";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/cordis-plugin-timer"; // 类型面：ctx.interval/ctx.timeout 增强
import type {} from "@deepseek-ai/dsh-client-connection"; // 类型面：Context.connection 增强
import { createPlugin, probeNodeSqlite, unsupportedSqliteError, type Plugin } from "../index";
import { ensureElectronDist } from "../pet/electronGet";
import { electronSpawner } from "../pet/supervisor";
import { dbFileFrom } from "../storage/paths";
import { registerEmbeddedSchemas } from "../storage/migrate";
import schemaRaw from "../storage/schema-raw";
import { subagentExecutorPlaceholder } from "../judge/adapters";
import type { HelperSpawner } from "../pet/supervisor";
import type { TimerApi as LoopTimer } from "../dispatch/autoDispatch";
import { registerTodoTools } from "./toolRegister";
import { PkyRemoteService } from "./remoteService";
import { remotePlatformOf, wireRemoteGuard, type RemoteAssembly } from "./remoteAssembly";

// 契约 SQL 编译期内嵌注册（migrate 双 loader 的内嵌侧）：安装形态磁盘相对路径不可达，
// dist 产物经 build.mjs 的 ?raw loader 内嵌——模块加载期注册一次（fs 回落留给仓内 dev 直跑）
registerEmbeddedSchemas({ ...schemaRaw });

// 远程派发适配面（任务 2.1/2.2 产出；接线归任务 2.9）：此处仅再出口使模块进构建图——
// 保持 `import("@deepseek-ai/dsh-ssh")` 动态字面量落进 dist（external 口径，运行时从
// 插件包闭包解析——spike 验证点③）；不改变 apply 行为（惰性装载语义不变）
export { createSshScopeHost, type CordisHostContext, type SshScopeHost } from "./sshScope";
export { DSH_CAPABILITY_KEYS, probeDshCapabilities, sshFamilyOf } from "./probeDsh";

/** 入口 id（cordis.patch.yml 的 insert id 同名；包名 dsh-plugin 是安装定位面） */
export const name = "pokemon-choose-you";

/** 必需服务（timer 的 ctx.interval 增强面需要 inject 声明） */
export const inject = ["tools", "timer"];

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
    .union(["subagent", "cli"])
    .default("subagent")
    .volatile()
    .description("判定执行方：subagent = dsh subagent 桥（Phase B 落型，当前占位）；cli = 主 agent CLI 子进程"),
});

/** loader 解析后的 config 形态（volatile 字段为 { get() } 引用；兼容普通值便于测试） */
export interface ResolvedPkyConfig {
  petAutoStart: { get(): boolean } | boolean;
  judgeExecutor: { get(): "subagent" | "cli" } | "subagent" | "cli";
}

/** volatile/普通值兼容读取（live 表单改值经 .get() 生效） */
function readSetting<T>(field: { get(): T } | T): T {
  return typeof field === "object" && field !== null && typeof (field as { get?: unknown }).get === "function"
    ? (field as { get(): T }).get()
    : (field as T);
}

/** createPlugin 依赖注入面（timer/桌宠 spawner/判定执行方/远程平台——接线单源） */
function pluginDepsOf(
  ctx: Context,
  config: ResolvedPkyConfig,
  dbPath: string,
  petSpawner: HelperSpawner | undefined,
  remote: RemoteAssembly,
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
    petAutoStart: {
      // D18「随 dsh 启动」默认开：宿主配置面未显式写 false 时视为开（schemastery
      // default(true) 在 dsh 配置面未落值时不生效——真机冒烟实测，未设值 = undefined）
      get: () => readSetting(config.petAutoStart) !== false,
      set: () => undefined, // 平台持久化归 dsh 配置面（Phase B 客户端设置段写回）
    },
    // 判定执行方：cli = 业务核心缺省（主 agent CLI 子进程）；subagent = 占位桥
    // （调用即明确报错不静默——Phase B 换 dsh subagents 真实接面）
    newExecutor: readSetting(config.judgeExecutor) === "cli" ? undefined : () => subagentExecutorPlaceholder(),
    // dispatchDeps/terminal/larkBin 缺省：lark-cli 走 PATH；交互终端 fake 占位
    // （dsh terminal 表面后续任务接面；无头派发 executorFor 缺省走 local 子进程）
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
    throw new Error("[dsh-plugin] 无法定位待办库：CHOOSE_YOU_HOME 与 home 均不可用（AD §5.1 库定位）");
  }
  process.stderr.write(`[pokemon-choose-you] 待办库：${dbPath}\n`);
  const petSpawner = detectPetSpawner();
  // 远程部署平台面（full-parity 2.9）：scope 宿主 + 家族探测投影 + 闭包 helper 制品
  const remote = remotePlatformOf(ctx);
  const plugin = createPlugin(pluginDepsOf(ctx, config, dbPath, petSpawner, remote));
  wireRemoteGuard(ctx, plugin, remote);
  degradePetRuntime(plugin, petSpawner);
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
 * 定位桌宠 spawner：helper 主产物（helper/dist/main.js）+ electron **真实二进制**。
 * 探测链（注释即探测顺序单源）：
 *   helper 主产物：从本模块目录逐级向上（仓内 dev：src/host/dsh → 包根；构建产物：dist → 包根；
 *     profile 安装：node_modules/dsh-plugin/dist → 包根——file: 安装带 helper/ 才有）
 *   electron：node_modules/electron/dist/ 下的平台二进制（helper 子包 devDep → 插件包根 →
 *     仓库根，跟随 symlink 可达 pnpm store 真实位）
 *     → ~/.dsh/electron/（dsh-pet 先例的运行时下载位：electron / bin/electron /
 *        dist/Electron.app/Contents/MacOS/Electron）
 *   刻意绕开 .bin/electron wrapper：它是 node cli.js 中间层——supervisor 的 kill 落在
 *   wrapper 上（信号转发不带走 Electron，hide 后 Electron 成孤儿、窗口残留，再 show 叠新窗）。
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
