/**
 * 纯 dsh 场景的本机 pk 落位（ADR-0006）：`~/.choose-you/bin/pk` 与插件包 dist/pk.mjs
 * 保持同源（缺失落位 / 漂移覆盖重拷——ts-pk-and-agent-plugins 起为 TS 单文件 bundle，
 * 不再 vendor Rust 二进制）。pk 通道开通（`pk remote setup`）经同一脚本——桌面 app
 * 已装机器上两端并存，shim last-writer-wins 收敛（specs pk-channel）。
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
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

/**
 * 确保本机 pk 可用：bundle 在场时落位与其保持同源（不一致即覆盖——重构建后无需手动
 * 清落位；「已存在直接用」仅在 bundle 缺件时成立）。unix 落 pk（shebang 已内嵌）；
 * Windows 落 pk.cmd 包装 + pk.mjs（无扩展名脚本不可直接执行）。
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
  return isWindows ? placeWindows(target, bundle) : placeUnix(target, bundle);
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

/** unix 落位：pk（shebang 已内嵌）+ 执行位；与 bundle 漂移即覆盖 */
function placeUnix(target: string, bundle: string): string {
  if (!existsSync(target) || !sameBytes(target, bundle)) {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(bundle, target);
    chmodSync(target, 0o755);
  }
  return target;
}
