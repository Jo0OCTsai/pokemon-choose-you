/**
 * dsh/probeDsh.ts —— capability 探测实装（AD §4.8 / FR-RD7）：dsh 平台表面键的装配期
 * 真实探测，结果进 diagnosticsSnapshot 的 capabilities 段（响应扩展归任务 2.9——本
 * 模块只提供探测函数 + 数据结构）；sshFamily 字段 = capabilities.dsh-ssh 的呈现投影
 * （sshFamilyOf——单源合并声明，不另立第二条探测路径）。
 *
 * 键集口径：本模块覆盖 CAPABILITY_KEYS（src/host/index.ts 单源）的 dsh 子集
 * （DSH_CAPABILITY_KEYS ⊆ CAPABILITY_KEYS，单测双向锁一致）；node-runtime /
 * node-sqlite 归 index.ts 既有探测（probeNodeRuntime / probeNodeSqlite），装配层
 * 合流进同一 capabilities 段。
 *
 * 探测方式（AD §4.8 表 / docs/compatibility.md 矩阵同步）：
 * - dsh-ssh：动态 import 家族双包可解析 + 导出面形状（default class + 静态 Config）
 * - dsh-terminal：宿主 ctx 终端表面（subprocess.spawnTerminal / ctx.terminals）
 * - dsh-session / dsh-worktrees / dsh-timer：ctx 注入面存在性
 * - dsh-storage / dsh-slots：ctx 注入面存在性；宿主无对应服务 → 按前序自持口径标 ok
 *   （插件 storage 唯一握连接 / dispatch_slots 库内实现——detail 注明自持）
 *
 * 单测：__tests__/dsh-probe.spec.ts（fake ctx 表面全枚举 + 本机闭包真实动态 import）。
 */
import { createRequire } from "node:module";

/** dsh 平台面 capability 键（CAPABILITY_KEYS 的 dsh 子集；矩阵「探测键」列同源） */
export const DSH_CAPABILITY_KEYS = [
  "dsh",
  "dsh-ssh",
  "dsh-terminal",
  "dsh-session",
  "dsh-worktrees",
  "dsh-timer",
  "dsh-storage",
  "dsh-slots",
] as const;

export type DshCapabilityKey = (typeof DSH_CAPABILITY_KEYS)[number];

export type DshCapabilityProbes = Record<DshCapabilityKey, CapabilityProbe>;

/** 单键探测结果（diagnosticsSnapshot capabilities 段的条目形态） */
export interface CapabilityProbe {
  ok: boolean;
  /** 机器稳定 detail（诊断段呈现：版本号 / 表面名 / 自持说明 / 缺失指引） */
  detail: string;
}

/** 装配层传入的宿主 ctx 表面（结构探测——字段存在性即注入面存在性；测试可注入 fake） */
export interface DshHostSurface {
  isolate?: unknown;
  plugin?: unknown;
  timer?: unknown;
  interval?: unknown;
  subprocess?: { spawnTerminal?: unknown };
  terminals?: unknown;
  sessions?: unknown;
  worktrees?: unknown;
  storage?: unknown;
  slots?: unknown;
}

/** 报错摘要（截长防诊断段膨胀） */
function brief(error: unknown): string {
  return String(error).slice(0, 200);
}

/** 读插件包闭包内某包版本（exports 含 ./package.json；dist/test 两形态同锚点） */
function closureVersion(pkg: string): string | undefined {
  try {
    const pkgJson = createRequire(import.meta.url)(`${pkg}/package.json`) as { version?: unknown };
    return typeof pkgJson.version === "string" ? pkgJson.version : undefined;
  } catch {
    return undefined;
  }
}

// ---- dsh-ssh 家族（动态 import + 导出面形状——AD §4.8 主行） ----

/** 家族插件导出面形状判据（cordis 插件形态：default 为 class，且带静态 Config
 * （dsh-ssh）或静态 inject 声明（dsh-subprocess-ssh）——两种插件标记任一在场） */
function familyFaceOk(mod: object): { ok: boolean; name: string } {
  const face = (mod as { default?: unknown }).default ?? mod;
  const statics = face as { Config?: unknown; inject?: unknown; name?: unknown };
  const marked = typeof face === "function" && (statics.Config !== undefined || Array.isArray(statics.inject));
  const name = typeof statics.name === "string" ? statics.name : "unknown";
  return { ok: marked, name };
}

async function probeSshFamily(): Promise<CapabilityProbe> {
  let sshMod: object;
  let subprocessMod: object;
  try {
    [sshMod, subprocessMod] = await Promise.all([
      import("@deepseek-ai/dsh-ssh"),
      import("@deepseek-ai/dsh-subprocess-ssh"),
    ]);
  } catch (error) {
    return {
      ok: false,
      detail: `dsh-ssh 家族动态 import 失败：${brief(error)}——远程派发不可用，重装插件（依赖钉版 0.1.6-alpha.1）`,
    };
  }
  const ssh = familyFaceOk(sshMod);
  const subprocess = familyFaceOk(subprocessMod);
  if (!ssh.ok || !subprocess.ok) {
    return {
      ok: false,
      detail: `dsh-ssh 家族导出面形状不符（${ssh.name}/${subprocess.name} 缺 class+Config/inject 标记）——版本漂移，检查钉版 0.1.6-alpha.1`,
    };
  }
  const version = closureVersion("@deepseek-ai/dsh-ssh");
  return {
    ok: true,
    detail: `dsh-ssh${version === undefined ? "" : `@${version}`} + dsh-subprocess-ssh（动态 import 解析至插件包闭包；最低版本 0.1.6-alpha.1）`,
  };
}

// ---- ctx 表面探测（注入面存在性） ----

/**
 * 安全读 ctx 注入面：真实 cordis Context 对未声明 inject 的服务名**访问即抛**
 * （"cannot get property X without inject"——代理 get 拦截，非 undefined）；
 * 抛错按「宿主未提供该面」处理。fake ctx（测试）无代理，行为不变。
 */
function surfaceOf(ctx: DshHostSurface | undefined, key: keyof DshHostSurface): unknown {
  if (ctx === undefined) {
    return undefined;
  }
  try {
    return ctx[key];
  } catch {
    return undefined;
  }
}

function probePlatform(ctx?: DshHostSurface): CapabilityProbe {
  if (ctx !== undefined && typeof ctx.isolate === "function" && typeof ctx.plugin === "function") {
    return { ok: true, detail: "dsh 宿主进程内运行（ctx.isolate/plugin 表面在场；基线 0.2.1-rc.2）" };
  }
  return { ok: false, detail: "宿主 ctx 表面缺席（不在 dsh 宿主内运行或表面未注入）" };
}

function probeTerminal(ctx?: DshHostSurface): CapabilityProbe {
  const subprocess = surfaceOf(ctx, "subprocess") as { spawnTerminal?: unknown } | undefined;
  const terminals = surfaceOf(ctx, "terminals");
  const spawnTerminal = subprocess?.spawnTerminal;
  if (typeof spawnTerminal === "function") {
    const panels = terminals !== undefined ? "（宿主 terminals 面板服务在场）" : "";
    return { ok: true, detail: `subprocess.spawnTerminal 可用${panels}` };
  }
  if (terminals !== undefined) {
    return {
      ok: true,
      detail: "宿主 ctx.terminals 在场（终端面板服务可用；spawnTerminal 原语不在宿主 subprocess 面）",
    };
  }
  return { ok: false, detail: "宿主未提供终端表面（spawnTerminal/terminals 均缺席）——交互派发降级「复制命令行」" };
}

function probeTimer(ctx?: DshHostSurface): CapabilityProbe {
  const interval = surfaceOf(ctx, "interval");
  const timer = surfaceOf(ctx, "timer");
  if (typeof interval === "function" || timer !== undefined) {
    return { ok: true, detail: "ctx.interval/timer 在场（cordis-plugin-timer 轮询载体）" };
  }
  return { ok: false, detail: "宿主未提供 timer 表面（ctx.interval/timer 缺席）——轮询循环降级宿主缺省定时器" };
}

function probeInjectSurface(ctx: DshHostSurface | undefined, key: string, absentNote: string): CapabilityProbe {
  const surface = surfaceOf(ctx, key as keyof DshHostSurface);
  if (surface !== undefined) {
    return { ok: true, detail: `宿主 ctx.${key} 注入面在场` };
  }
  return { ok: false, detail: `宿主未提供 ctx.${key}——${absentNote}` };
}

/** storage/slots：宿主无对应服务 → 前序自持口径（插件不依赖该两面，标 ok + detail 注明） */
function probeSelfHosted(ctx: DshHostSurface | undefined, key: string, note: string): CapabilityProbe {
  const surface = surfaceOf(ctx, key as keyof DshHostSurface);
  if (surface !== undefined) {
    return { ok: true, detail: `宿主 ctx.${key} 注入面在场` };
  }
  return { ok: true, detail: `宿主无 ctx.${key}——按前序自持口径（${note}）` };
}

/**
 * 装配期 dsh 平台面探测（diagnosticsSnapshot capabilities 段数据源）。
 * ctx = 宿主 Cordis Context（装配层传入；测试/非宿主环境可省略——dsh-ssh 键仍真实探测）。
 */
export async function probeDshCapabilities(ctx?: DshHostSurface): Promise<DshCapabilityProbes> {
  return {
    dsh: probePlatform(ctx),
    "dsh-ssh": await probeSshFamily(),
    "dsh-terminal": probeTerminal(ctx),
    "dsh-session": probeInjectSurface(ctx, "sessions", "判定会话通道不可用（诊断呈现，不阻断核心闭环）"),
    "dsh-worktrees": probeInjectSurface(ctx, "worktrees", "宿主无 worktrees 注入面（基线宿主未提供；诊断呈现）"),
    "dsh-timer": probeTimer(ctx),
    "dsh-storage": probeSelfHosted(ctx, "storage", "插件 storage 唯一握连接，不依赖宿主 storage 服务"),
    "dsh-slots": probeSelfHosted(ctx, "slots", "并发槽由插件 dispatch_slots 库内实现，不依赖宿主 slots 服务"),
  };
}

/** sshFamily 呈现投影的条目形态（AD §4.1 diagnosticsSnapshot 扩展字段——响应面归 2.9） */
export interface SshFamilyProjection {
  ok: boolean;
  detail: string;
  /** 缺失指引标志：远程派发入口降级指引 + ShellRunner 直连链（D31 前提）判定用 */
  missing: boolean;
}

/** capabilities.dsh-ssh → sshFamily 投影（单源合并声明——不另立第二条探测路径） */
export function sshFamilyOf(probes: DshCapabilityProbes): SshFamilyProjection {
  const probe = probes["dsh-ssh"];
  return { ok: probe.ok, detail: probe.detail, missing: !probe.ok };
}
