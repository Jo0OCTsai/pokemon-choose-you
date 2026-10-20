/**
 * 本地子进程环境解析（src-tauri/src/which.rs + ai/invocation.rs agent_workdir 同构）。
 *
 * dsh 桌面 App 从 Dock/Finder 启动的 GUI 进程不继承登录 shell 的 PATH，npm/brew/nvm
 * 装的 agent CLI 裸名 spawn 直接 ENOENT；配置里的 `~/...` 工作目录 Node spawn 不展开，
 * cwd 不存在时报的也是 `spawn <cmd> ENOENT`（与找不到命令同一文案）。两者在此统一解析，
 * 执行器只消费结果：找不到时原样返回交由调用方报可操作指引。
 */
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { localPkDir } from "../remote/pkLocal";

/** `~` / `~/x` 展开为 home 下绝对路径（仅 ~/ 前缀，agent_workdir 同语义）；其余原样；空白 → undefined（继承宿主 cwd） */
export function expandHome(dir: string | null | undefined, home: string = homedir()): string | undefined {
  const trimmed = (dir ?? "").trim();
  if (trimmed === "") {
    return undefined;
  }
  if (trimmed === "~") {
    return home;
  }
  return trimmed.startsWith("~/") ? join(home, trimmed.slice(2)) : trimmed;
}

/**
 * GUI 进程常缺的可执行目录（extra_bin_dirs_in 同构）：Homebrew / npm 全局前缀改到用户目录 /
 * volta / asdf 等版本管理器；nvm 一个 node 版本一个 bin 目录，全量收进来、新版本优先。
 */
export function extraBinDirs(home: string | undefined = homedir()): string[] {
  const dirs = ["/usr/local/bin", "/opt/homebrew/bin", "/home/linuxbrew/.linuxbrew/bin"];
  if (home === undefined || home === "") {
    return dirs;
  }
  dirs.push(
    join(home, ".npm-global/bin"),
    join(home, ".volta/bin"),
    join(home, ".asdf/shims"),
    join(home, ".local/bin"),
    join(home, "bin"),
  );
  dirs.push(...nvmBinDirs(join(home, ".nvm/versions/node")));
  return dirs;
}

/** nvm 版本 bin 目录，按版本号数字段降序（字典序会把 v9 排在 v20 后） */
function nvmBinDirs(root: string): string[] {
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  return names.sort((a, b) => compareVersionDesc(versionKey(a), versionKey(b))).map((v) => join(root, v, "bin"));
}

function versionKey(name: string): number[] {
  return name
    .replace(/^v/, "")
    .split(".")
    .map((seg) => Number.parseInt(seg, 10) || 0);
}

function compareVersionDesc(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (b[i] ?? 0) - (a[i] ?? 0);
    if (d !== 0) {
      return d;
    }
  }
  return 0;
}

/**
 * 裸命令名 → 绝对路径（resolve_in 同构）：先按进程 PATH，再补扫 extraBinDirs；
 * 空名 / 显式路径（含路径分隔符）不改写；找不到原样返回。
 */
export function resolveCommand(
  bin: string,
  pathEnv: string | undefined = process.env.PATH,
  home: string | undefined = homedir(),
): string {
  if (bin === "" || /[\\/]/.test(bin)) {
    return bin;
  }
  const dirs = [...splitPath(pathEnv), ...extraBinDirs(home)];
  for (const dir of dirs) {
    const candidate = join(dir, bin);
    if (isFile(candidate)) {
      return candidate;
    }
  }
  return bin;
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function splitPath(pathEnv: string | undefined): string[] {
  return (pathEnv ?? "").split(delimiter).filter((d) => d !== "");
}

/**
 * node 脚本宿主目录（script_host_dirs_in 同构）：脚本所在目录 + node 所在目录（去重；裸名无父目录跳过）。
 * claude / lark-cli 等 npm 全局 CLI 是 `#!/usr/bin/env node` 脚本，GUI 精简 PATH 下被直接 spawn 时
 * shebang 的 env 找不到 node（退出码 127）——这些目录前插子进程 PATH 补齐。
 */
export function scriptHostDirs(bin: string, nodeBin: string): string[] {
  const dirs: string[] = [];
  for (const cand of [bin, nodeBin]) {
    const dir = dirname(cand);
    if (dir !== "." && dir !== "" && !dirs.includes(dir)) {
      dirs.push(dir);
    }
  }
  return dirs;
}

/** 子进程 PATH（augmented_path 同构）：extra 前插、base 条目保留在后；extra 为空 → undefined（不改写环境） */
export function augmentedPath(extra: string[], base: string | undefined = process.env.PATH): string | undefined {
  if (extra.length === 0) {
    return undefined;
  }
  return [...extra, ...splitPath(base)].join(delimiter);
}

/** 进程环境里 PATH 的实际键名（Windows 可能是 Path；缺省 PATH）——覆写时沿用原键避免双键并存 */
export function pathEnvKey(env: NodeJS.ProcessEnv = process.env): string {
  return Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
}

/**
 * agent 子进程凭据环境提供者（dsh 形态凭据注入——适配层注入，业务核心只消费）：
 * dsh-headless 出厂禁用 credentials 服务（bundle patch「一次性任务用启动时凭据」），
 * GUI 宿主进程环境又没有 DEEPSEEK_API_KEY——适配层经宿主 credentials 服务解析后
 * 经本提供者注入派发/判定子进程。契约：不抛错（未命中或内部异常一律返回 undefined
 * = 不注入，子进程按原环境跑、由 dsh 自身报错）；凭据不落盘、不进命令行、不打日志。
 */
export type AgentEnvProvider = (program: string) => Promise<Record<string, string> | undefined>;

/** 提供者缺席/未命中归一为 undefined（调用点直填 job.env / spawn opts.env，省各自分支） */
export async function resolveAgentEnv(
  provider: AgentEnvProvider | undefined,
  program: string,
): Promise<Record<string, string> | undefined> {
  return provider === undefined ? undefined : await provider(program);
}

/**
 * 子进程环境（runner.rs run_agent / spawn_and_wait 同构）：宿主环境 + [本机 pk 目录] +
 * 命令与 node 所在目录前插 PATH（agent 内 `pk context` / `pk suggest` 裸名可达——落位缺席
 * 不注入；`#!/usr/bin/env node` 脚本在 GUI 精简 PATH 下找得到 node）+ extra 注入最后覆盖。
 */
export function childEnvFor(program: string, extra: Record<string, string> | undefined): NodeJS.ProcessEnv {
  const pkDir = localPkDir();
  const dirs = [...(pkDir === undefined ? [] : [pkDir]), ...scriptHostDirs(program, resolveCommand("node"))];
  const path = augmentedPath(dirs);
  return { ...process.env, ...(path === undefined ? {} : { [pathEnvKey()]: path }), ...extra };
}

/** spawn 失败的可操作指引：ENOENT 同时覆盖「命令找不到」与「工作目录不存在」（Node 同一文案），runner.rs NotFound 同款；其余空串 */
export function spawnErrorHint(message: string): string {
  return message.includes("ENOENT")
    ? "（找不到命令或工作目录不存在：请确认该 agent CLI 已安装、工作目录存在；GUI 进程可能看不到终端的 PATH，可在设置中改填绝对路径）"
    : "";
}
