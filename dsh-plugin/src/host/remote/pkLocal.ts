/**
 * 纯 dsh 场景的本机 pk 落位（ADR-0006）：`~/.choose-you/bin/pk` 与插件包 dist/pk.mjs
 * 保持同源（缺失落位 / 漂移覆盖重拷——ts-pk-and-agent-plugins 起为 TS 单文件 bundle，
 * 不再 vendor Rust 二进制）。unix 落位是 wrapper（内嵌 node 绝对路径）+ 同目录 pk.mjs
 * 双文件：sshd forced command 跑在默认 PATH（无 Homebrew/nvm），裸 env-node shebang
 * 该语境必失败（真机实测 env: node: No such file or directory）。pk 通道开通
 * （`pk remote setup`）经同一脚本——桌面 app 已装机器上两端并存，shim last-writer-wins
 * 收敛（specs pk-channel）；桌面 app 自带 Rust 二进制自包含，与 wrapper 落位互覆盖均可用。
 */
import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { posixQuote } from "../dispatch/cmdline";
import { appHome } from "../storage/paths";

const isWindows = process.platform === "win32";

/** 本机 pk 落点（<appHome>/bin/pk——shim 内嵌路径与桌面侧定位的统一约定） */
export function localPkPath(): string | undefined {
  const home = appHome();
  return home === undefined ? undefined : join(home, "bin", "pk");
}

/** 本机 pk 所在目录（agent 子进程 PATH 注入面——runner.rs `locate_pk().parent()` 同构）；
 * 落位缺席（pk / pk.exe / pk.cmd 均不在）→ undefined 不注入 */
export function localPkDir(): string | undefined {
  const target = localPkPath();
  if (target === undefined) {
    return undefined;
  }
  const present = [target, `${target}.exe`, `${target}.cmd`].some((p) => existsSync(p));
  return present ? dirname(target) : undefined;
}

/**
 * 本机交互行 PATH 前缀：交互派发的命令行经用户登录 shell 执行（外部终端窗口 / copy-line
 * 手动粘贴——不吃 childEnvFor 的子进程注入面），落位在场才前插 `export PATH=<dir>:"$PATH" && `
 * （agent 内 `pk context` / `pk suggest` 裸名可达）；缺席返回空串不加（localPkDir 同缺席语义）。
 */
export function localPkPathPrefix(): string {
  const dir = localPkDir();
  return dir === undefined ? "" : `export PATH=${posixQuote(dir)}:"$PATH" && `;
}

/** 从起点目录向上找插件包根（dist → 包根；src/host/remote → 仓内包根）的 pk bundle
 * （dist/pk.mjs）；startAt 缺省 = 本模块位置（测试注入临时起点走「无 bundle」分支）。
 * ESM 铁律：定位用 import.meta.url——宿主按 ESM 加载 bundle，CJS 全局 __filename 不在场
 * （曾致开通命令报 ReferenceError: __filename is not defined） */
export function pkBundlePath(startAt?: string): string | undefined {
  let dir = startAt ?? dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(dir, "dist", "pk.mjs");
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

/** 两文件字节等价（大小不同速判；同大小比 sha256——重构建 pk 后落位跟随 bundle 更新） */
function sameBytes(a: string, b: string): boolean {
  try {
    const sa = statSync(a);
    const sb = statSync(b);
    if (!sa.isFile() || !sb.isFile() || sa.size !== sb.size) {
      return false;
    }
    const hash = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex");
    return hash(a) === hash(b);
  } catch {
    return false;
  }
}

/** Windows 的 pk.cmd 包装（node 无扩展名脚本不可直接执行；%~dp0 定位同目录 bundle） */
const PK_CMD_WRAPPER = '@node "%~dp0pk.mjs" %*\r\n';

/** wrapper 模板版本（结构变更时 bump——落位内容比对判定重写，bump 即全量刷新） */
const WRAPPER_TEMPLATE_VERSION = 1;

/** wrapper 首行标记（provenance：落位是谁写的、什么版本——doctor 与人工排障可读） */
export function wrapperMarker(pluginVersion: string): string {
  return `# pky-pk-wrapper v${WRAPPER_TEMPLATE_VERSION} (${pluginVersion})`;
}

/**
 * unix 落位 wrapper 脚本：pk 通道回连由本机 sshd 经 authorized_keys forced command
 * 执行，sshd 给的是默认 PATH（/usr/bin:/bin:…，无 Homebrew/nvm）——裸 `#!/usr/bin/env
 * node` 的 bundle 拷贝在该语境 `env: node: No such file or directory`（真机实测）。
 * wrapper 内嵌落位时解析的 node 绝对路径直启同目录 pk.mjs；路径漂移（nvm 换版本等）
 * 回落 PATH，仍不可达给出修复指引。absNode 为 null（宿主 PATH 解析不到 node）时
 * 只留 PATH 兜底——由开通 step1 的 sshd 语境预检当场暴露并给指引。
 */
export function pkWrapperScript(absNode: string | null, pluginVersion: string): string {
  const direct = absNode === null ? "" : `[ -x "${absNode}" ] && exec "${absNode}" "$d/pk.mjs" "$@"\n`;
  return (
    "#!/bin/sh\n" +
    `${wrapperMarker(pluginVersion)} —— sshd forced command 等最小 PATH 环境无 Homebrew/nvm node，\n` +
    "# 内嵌落位时解析的绝对路径直启同目录 pk.mjs；失效回落 PATH，仍不可达给出修复指引\n" +
    'd=$(dirname "$0")\n' +
    direct +
    'command -v node >/dev/null 2>&1 && exec node "$d/pk.mjs" "$@"\n' +
    'echo "pk: 内嵌 node 路径失效且 PATH 无 node——重跑 pk 通道开通或 pk doctor 修复落位" >&2\n' +
    "exit 127\n"
  );
}

/** 从宿主 PATH 解析 node 绝对路径（无依赖版 which；找不到返回 null） */
export function resolveNodeBin(): string | null {
  const path = process.env.PATH ?? "";
  for (const dir of path.split(process.platform === "win32" ? ";" : ":")) {
    if (dir === "") continue;
    const candidate = join(dir, "node");
    try {
      accessSync(candidate, constants.X_OK);
      return resolve(candidate);
    } catch {
      // 该目录无 node，继续找
    }
  }
  return null;
}

/** 落位的 provenance 版本（bundle 同包的 package.json version；读不到回落 unknown） */
function pluginVersionOf(bundle: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(dirname(bundle), "..", "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

/** 校准结果缓存键（两个落位文件 + bundle + 同包 package.json 的 stat——provenance
 * 版本读自后者，须参与键；命中则跳过 sha/重写判定） */
function memoKey(target: string, mjs: string, bundle: string): string {
  const stat = (p: string): string => {
    try {
      const s = statSync(p);
      return `${s.mtimeMs}:${s.size}`;
    } catch {
      return "x";
    }
  };
  const pkgJson = join(dirname(bundle), "..", "package.json");
  return [target, mjs, bundle, pkgJson].map((p) => `${p}@${stat(p)}`).join("|");
}

let ensureMemo: { key: string; result: string | undefined } | null = null;

/**
 * 确保本机 pk 可用：bundle 在场时落位与其保持同源（不一致即覆盖——重构建后无需手动
 * 清落位；「已存在直接用」仅在 bundle 缺件时成立）。unix 落 wrapper + pk.mjs 双文件
 * （见 pkWrapperScript）；Windows 落 pk.cmd 包装 + pk.mjs（无扩展名脚本不可直接执行）。
 * stat 缓存：三文件（落位两件 + bundle）stat 未变时直接复用上次结果——消费点校准
 * （插件启动/开通）零摊销，漂移判定只在真实变化后重算。
 * bundleOverride 仅供测试注入（指向一个充当 bundle 的文件）。
 */
export function ensureLocalPk(bundleOverride?: string): string | undefined {
  const target = localPkPath();
  if (target === undefined) {
    return undefined;
  }
  const bundle = bundleOverride ?? pkBundlePath();
  if (bundle === undefined || !existsSync(bundle)) {
    return existsSync(target) ? target : undefined;
  }
  if (isWindows) {
    return placeWindows(target, bundle);
  }
  const mjs = `${target}.mjs`;
  const key = memoKey(target, mjs, bundle);
  if (ensureMemo !== null && ensureMemo.key === key) {
    return ensureMemo.result;
  }
  const result = placeUnix(target, mjs, bundle);
  ensureMemo = { key: memoKey(target, mjs, bundle), result };
  return result;
}

/** Windows 落位：pk.cmd 包装 + pk.mjs（无扩展名脚本不可直接执行） */
function placeWindows(target: string, bundle: string): string {
  const mjs = `${target}.mjs`;
  const cmd = `${target}.cmd`;
  if (!existsSync(mjs) || !sameBytes(mjs, bundle) || !existsSync(cmd)) {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(bundle, mjs);
    writeFileSync(cmd, PK_CMD_WRAPPER);
  }
  return cmd;
}

/** unix 落位：wrapper（内嵌 node 绝对路径 + provenance 标记，0o755）+ 同目录 pk.mjs。
 * 重写判定按内容：wrapper 与期望文本逐字节比（模板版本/插件版本/node 路径任一变化即
 * 重写），pk.mjs 走 sameBytes——Rust 二进制、裸 mjs 等旧形态落位被命中即自动迁移 */
function placeUnix(target: string, mjs: string, bundle: string): string {
  const wantWrapper = pkWrapperScript(resolveNodeBin(), pluginVersionOf(bundle));
  let currentWrapper = "";
  try {
    currentWrapper = readFileSync(target, "utf8");
  } catch {
    // 不存在按空处理（首落位）
  }
  const needWrapper = currentWrapper !== wantWrapper;
  const needMjs = !existsSync(mjs) || !sameBytes(mjs, bundle);
  if (needWrapper || needMjs) {
    mkdirSync(dirname(target), { recursive: true });
    if (needMjs) {
      copyFileSync(bundle, mjs);
    }
    if (needWrapper) {
      writeFileSync(target, wantWrapper);
      chmodSync(target, 0o755);
    }
  }
  return target;
}
