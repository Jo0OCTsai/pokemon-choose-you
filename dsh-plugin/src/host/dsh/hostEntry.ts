/**
 * dsh（DeepSeek Harness）宿主插件入口（平台胶水层，Phase A host 半边真实适配）。
 *
 * 形态（dsh 0.2.0-rc.2 插件清单）：本包经 `dsh plugin --profile <name> add file:…`
 * 作为自注册 bundle 安装（包内 cordis.patch.yml insert 本 entry），loader 读
 * package.json main（dist/host.js）加载本模块，消费具名导出 name/inject/Config/apply。
 *
 * 职责边界：本层只做平台接线——能力探测、createPlugin 依赖注入（timer/pet spawner/
 * 判定执行方）、22 工具 → ctx.tools（defineTool JSON DSL 投影）、55 host 命令 →
 * connection 共享 /api 通道 `pky/<command>` 端点；业务行为全部在 src/host/** 业务核心。
 *
 * inject 就地决策：connection 服务只在 web 组合（dsh-web-app）存在，headless 组合
 * 不装载——若列入入口 inject 会阻断 headless 下的插件启动（冒烟口径），故入口只
 * 声明 tools/timer，connection 经 apply 内 ctx.inject 按需挂（api-gateway 同款模式）。
 */
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/cordis-plugin-timer"; // 类型面：ctx.interval/ctx.timeout 增强
import type {} from "@deepseek-ai/dsh-client-connection"; // 类型面：Context.connection 增强
import { createPlugin, probeNodeSqlite, unsupportedSqliteError, type Plugin } from "../index";
import { dbFileFrom } from "../storage/paths";
import { registerEmbeddedSchemas } from "../storage/migrate";
import schemaRaw from "../storage/schema-raw";
import type { PkyResult } from "../storage/errors";
import { subagentExecutorPlaceholder } from "../judge/adapters";
import type { ToolContext } from "../tools/registry";
import type { HelperSpawner } from "../pet/supervisor";
import type { TimerApi as LoopTimer } from "../dispatch/autoDispatch";
import { toDslParameters, TODO_TOOL_PARAM_DECLS } from "./toolSchema";
import { PKY_RPC_CHANNEL, createPkyRpcDispatcher } from "./rpcDispatch";

// 契约 SQL 编译期内嵌注册（migrate 双 loader 的内嵌侧）：安装形态磁盘相对路径不可达，
// dist 产物经 build.mjs 的 ?raw loader 内嵌——模块加载期注册一次（fs 回落留给仓内 dev 直跑）
registerEmbeddedSchemas({ ...schemaRaw });

/** 入口 id（cordis.patch.yml 的 insert id 同名；包名 dsh-plugin 是安装定位面） */
export const name = "pokemon-choose-you";

/** 必需服务（connection 按 headless 兼容就地下放——见文件头说明） */
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

/** 工具输出 schema：ok/fail 信封本身（json = 注解式放行，信封结构归 PROTOCOL §2 单源） */
const TOOL_OUTPUT_SCHEMA = {
  type: "json",
  description: "ok/fail 信封（PROTOCOL §2）：{ok:true,data} | {ok:false,error:{code,message,hint?}}",
} as const;

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
  const petSpawner = detectPetSpawner();
  const plugin = createPlugin({
    dbPath,
    pollTimer: (cb, ms) => ctx.interval(cb, ms),
    autoTimer: loopTimerOf(ctx),
    feedTimer: loopTimerOf(ctx),
    petSpawner,
    petAutoStart: {
      get: () => readSetting(config.petAutoStart) === true,
      set: () => undefined, // 平台持久化归 dsh 配置面（Phase B 客户端设置段写回）
    },
    // 判定执行方：cli = 业务核心缺省（主 agent CLI 子进程）；subagent = 占位桥
    // （调用即明确报错不静默——Phase B 换 dsh subagents 真实接面）
    newExecutor: readSetting(config.judgeExecutor) === "cli" ? undefined : () => subagentExecutorPlaceholder(),
    // dispatchDeps/terminal/larkBin 缺省：lark-cli 走 PATH；交互终端 fake 占位
    // （dsh terminal 表面后续任务接面；无头派发 executorFor 缺省走 local 子进程）
  });
  if (petSpawner === undefined) {
    warnDegrade(plugin, "桌宠降级停用（A20）：未定位到 helper/dist/main.js 或 electron 二进制");
  }
  // 装配逆序注册：dispose 最先进 effect → 卸载时最后执行（先注销工具/RPC，再收口循环与连接）
  ctx.effect((): (() => void) => plugin.dispose);
  registerTodoTools(ctx, plugin);
  registerRpcChannel(ctx, plugin);
}

/** 循环 timer 面（autoDispatch 与 stateFeed 同形：every/cancel → ctx.interval 反注册函数） */
function loopTimerOf(ctx: Context): LoopTimer {
  return {
    every: (ms, fn) => ctx.interval(fn, ms),
    cancel: (handle) => (handle as () => void)(),
  };
}

/** 22 工具 → ctx.tools.register(defineTool(...))；信封经 output/render 投影文本块 */
function registerTodoTools(ctx: Context, plugin: Plugin): void {
  const supervisor = plugin.supervisor;
  const toolCtx: ToolContext = {
    conn: plugin.conn,
    origin: "dsh:tools",
    pet: supervisor === null ? undefined : { show: () => supervisor.show(), hide: () => supervisor.hide() },
  };
  for (const def of plugin.tools.defs) {
    const definition = defineTool({
      name: def.name,
      description: def.summary,
      parameters: toDslParameters(TODO_TOOL_PARAM_DECLS[def.name] ?? {}),
      output: {
        schema: TOOL_OUTPUT_SCHEMA,
        render: (_args: unknown, value: unknown) => [{ type: "text", text: renderEnvelope(value) }],
      },
      execute: (args: unknown) =>
        plugin.tools.call(def.name, args, toolCtx).then((result) => result as unknown as never),
    });
    ctx.effect(() => ctx.tools.register(definition));
  }
}

/** 信封 → 模型可读文本（失败行首标错误码，hint 换行跟随） */
function renderEnvelope(value: unknown): string {
  const result = value as PkyResult<unknown>;
  if (result.ok) {
    return JSON.stringify(result.data ?? {}, null, 2);
  }
  const error = result.error;
  return `[${error.code}] ${error.message}${error.hint === undefined ? "" : `\nhint: ${error.hint}`}`;
}

/** 55 host 命令 → connection 自有通道 /pky（web 组合才有 connection；不占共享 /api——单拦截器独占，抢注会打死宿主网关） */
function registerRpcChannel(ctx: Context, plugin: Plugin): void {
  ctx.inject(["connection"], (connCtx: Context) => {
    const dispatch = createPkyRpcDispatcher(plugin.commands);
    connCtx.effect(() =>
      connCtx.connection.rpc.handle(PKY_RPC_CHANNEL, (endpoint, payload) => dispatch(endpoint, payload)),
    );
  });
}

// ---- 桌宠 helper 拉起面（spawner 定位 + electron 探测；找不到 = 降级停用不报错 A20） ----

/**
 * 定位桌宠 spawner：helper 主产物（helper/dist/main.js）+ electron 二进制。
 * 探测链（注释即探测顺序单源）：
 *   helper 主产物：从本模块目录逐级向上（仓内 dev：src/host/dsh → 包根；构建产物：dist → 包根；
 *     profile 安装：node_modules/dsh-plugin/dist → 包根——file: 安装带 helper/ 才有）
 *   electron：dsh-plugin/helper/node_modules/.bin/electron（helper 子包 devDep，仓内 dev）
 *     → dsh-plugin/node_modules/.bin/electron（插件包根依赖）
 *     → 仓库根 node_modules/.bin/electron（monorepo 形态）
 *     → ~/.dsh/electron/（dsh-pet 先例的运行时下载位：electron / bin/electron /
 *        dist/Electron.app/Contents/MacOS/Electron）
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
  return {
    spawn(args) {
      const child = spawn(electronBin, [helperDir, ...args], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });
      return {
        pid: child.pid,
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        on: (event, cb) => child.on(event, cb),
        once: (event, cb) => child.once(event, cb),
        kill: (signal) => child.kill(signal),
      };
    },
  };
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

/** electron 二进制候选定位（顺序见 detectPetSpawner 注释；全部 miss = undefined） */
function locateElectronBinary(helperDir: string): string | undefined {
  const pluginRoot = dirname(helperDir);
  const home = homedir();
  const candidates = [
    join(helperDir, "node_modules", ".bin", "electron"),
    join(pluginRoot, "node_modules", ".bin", "electron"),
    join(pluginRoot, "..", "node_modules", ".bin", "electron"),
    join(home, ".dsh", "electron", "electron"),
    join(home, ".dsh", "electron", "bin", "electron"),
    join(home, ".dsh", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron"),
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
