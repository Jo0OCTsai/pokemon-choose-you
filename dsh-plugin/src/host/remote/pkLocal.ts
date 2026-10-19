/**
 * 纯 dsh 场景的本机 pk 落位（ADR-0003 §4）：`~/.choose-you/bin/pk` 缺失时从插件包
 * vendor/ 拷当前平台 triple（构建时由 build.mjs 落位），已存在复用不覆盖。
 * pk 通道开通（`pk remote setup`）经同一二进制——桌面 app 已装机器上两端并存，
 * shim last-writer-wins 收敛（specs pk-channel）。
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { appHome } from "../storage/paths";

/** 本机 pk 落点（<appHome>/bin/pk——shim 内嵌路径与桌面侧定位的统一约定） */
export function localPkPath(): string | undefined {
  const home = appHome();
  return home === undefined ? undefined : join(home, "bin", "pk");
}

function hostTriple(): string {
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
 * startAt 缺省 = 本模块位置（测试注入临时起点走「无 vendor」分支） */
export function vendorDir(startAt?: string): string | undefined {
  let dir = startAt ?? dirname(__filename);
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

/**
 * 确保本机 pk 可用：`~/.choose-you/bin/pk` 存在 → 直接用；缺失 → vendor 落位
 * （chmod 0o755）。vendor 也缺席（如包分发缺件）→ undefined（pkSetup 命令降级拒绝）。
 * vendorOverride 仅供测试注入非默认 vendor 目录。
 */
export function ensureLocalPk(vendorOverride?: string): string | undefined {
  const target = localPkPath();
  if (target === undefined) {
    return undefined;
  }
  if (existsSync(target)) {
    return target;
  }
  const vendor = vendorOverride ?? vendorDir();
  const source = vendor === undefined ? undefined : join(vendor, `pk-${hostTriple()}`);
  if (source === undefined || !existsSync(source)) {
    return undefined;
  }
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  chmodSync(target, 0o755);
  return target;
}
