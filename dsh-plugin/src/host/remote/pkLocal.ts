/**
 * 纯 dsh 场景的本机 pk 落位（ADR-0003 §4）：`~/.choose-you/bin/pk` 与插件包 vendor/
 * 保持同源（缺失落位 / 与 vendor 漂移皆重拷当前平台 triple——构建时由 build.mjs 落位）。
 * pk 通道开通（`pk remote setup`）经同一二进制——桌面 app 已装机器上两端并存，
 * shim last-writer-wins 收敛（specs pk-channel）。
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { posixQuote } from "../dispatch/cmdline";
import { appHome } from "../storage/paths";

/** 本机 pk 落点（<appHome>/bin/pk——shim 内嵌路径与桌面侧定位的统一约定） */
export function localPkPath(): string | undefined {
  const home = appHome();
  return home === undefined ? undefined : join(home, "bin", "pk");
}

/** 本机 pk 所在目录（agent 子进程 PATH 注入面——runner.rs `locate_pk().parent()` 同构）；
 * 落位缺席（pk / pk.exe 均不在）→ undefined 不注入 */
export function localPkDir(): string | undefined {
  const target = localPkPath();
  if (target === undefined || !(existsSync(target) || existsSync(`${target}.exe`))) {
    return undefined;
  }
  return dirname(target);
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

/** 宿主三元组（构建/落位两侧命名一致单源；导出供测试自建 vendor） */
export function hostTriple(): string {
  const arch = process.arch === "arm64" ? "aarch64" : process.arch;
  const os =
    process.platform === "darwin"
      ? "apple-darwin"
      : process.platform === "win32"
        ? "pc-windows-msvc"
        : "unknown-linux-gnu";
  return `${arch}-${os}`;
}

/** 从起点目录向上找插件包根（dist → 包根；src/host/remote → 仓内包根）的 vendor 目录；
 * startAt 缺省 = 本模块位置（测试注入临时起点走「无 vendor」分支）。
 * ESM 铁律：定位用 import.meta.url——宿主按 ESM 加载 bundle，CJS 全局 __filename 不在场
 * （曾致开通命令报 ReferenceError: __filename is not defined） */
export function vendorDir(startAt?: string): string | undefined {
  let dir = startAt ?? dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(dir, "vendor");
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

/** 两文件字节等价（大小不同速判；同大小比 sha256——重建 pk 后落位跟随 vendor 更新） */
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

/**
 * 确保本机 pk 可用：vendor 在场时落位与其保持同源（不一致即覆盖——重建 pk 后无需
 * 手动清落位；「已存在直接用」仅在 vendor 缺件时成立）。vendorOverride 仅供测试注入。
 */
export function ensureLocalPk(vendorOverride?: string): string | undefined {
  const target = localPkPath();
  if (target === undefined) {
    return undefined;
  }
  const vendor = vendorOverride ?? vendorDir();
  const source = vendor === undefined ? undefined : join(vendor, `pk-${hostTriple()}`);
  if (source === undefined || !existsSync(source)) {
    return existsSync(target) ? target : undefined;
  }
  if (existsSync(target) && sameBytes(target, source)) {
    return target;
  }
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  chmodSync(target, 0o755);
  return target;
}
