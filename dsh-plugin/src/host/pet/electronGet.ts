/**
 * Electron 运行时按需获取（full-parity A32/D30 / AD §3.4）：`@electron/get` 严格校验模式
 * 薄封装。探测链已按 `~/.dsh/electron/dist/<平台二进制>` 命中（hostEntry.ts）——本模块
 * 下载 → 校验 → 解压 → **原子落位** `~/.dsh/electron/dist/`（staging 目录 rename，失败
 * 清理），落位即被探测。离线/失败返回手动放置指引文本（系统能力面降级提示不静默）。
 *
 * 校验纪律：**校验值 = 内嵌常量**（源出官方 releases SHASUMS256.txt）——经 `checksums`
 * 参数传入后 @electron/get 不再从镜像下载 SHASUMS 文件，镜像回落只换 URL 不换校验源。
 * 版本钉版与校验常量**同窗口更新**（升级 Electron = 改 ELECTRON_VERSION + 全量常量）。
 */
import { spawn } from "node:child_process";
import { mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { download, type ElectronDownloadRequestOptions } from "@electron/get";

/** Electron 稳定版钉版（与 helper devDep electron 同线；升级 = 本常量 + 校验常量同改） */
export const ELECTRON_VERSION = "44.7.0";

/**
 * 官方 releases 校验常量（源 = 官方 v44.7.0 SHASUMS256.txt，构建期内嵌）。
 * 适配注记：AD §2 表述「sha512 常量」——@electron/get 5.1.0 实测校验面 = sha256
 * （checksums → sumchecker sha256），本质不变（内嵌常量 + 镜像不换校验源），就地适配。
 */
export const ELECTRON_CHECKSUMS: Readonly<Record<string, string>> = {
  "electron-v44.7.0-darwin-arm64.zip": "e04e411b58a0a14375dd21b0ab4a378fd38930a702e4e20e322fee4849404c0b",
  "electron-v44.7.0-darwin-x64.zip": "4fe494a7159b10a81e2098dab388719582065e99e604c4510bb117e282213566",
  "electron-v44.7.0-linux-arm64.zip": "9cd736d1f5873839553c3fa6c8c5e57635ec4a399cc2d32e79c82a02d9cd2258",
  "electron-v44.7.0-linux-x64.zip": "3ae7d5bdad61c664486c6ab61361dd084d064c8c08af8d13a687096e18ce555a",
  "electron-v44.7.0-win32-x64.zip": "eee30dc8fa1f5ea95490e59f44e46ea68dd24c6e93d22facf70fe5c2d4c2665c",
};

/** 官方下载基址与镜像回落（只换 URL；校验源恒为 ELECTRON_CHECKSUMS） */
export const OFFICIAL_BASE = "https://github.com/electron/electron/releases/download";
export const NPMMIRROR_BASE = "https://npmmirror.com/mirrors/electron";

/** 平台二进制相对 dist 的路径（darwin = .app 包内执行档；win32 = electron.exe） */
export function electronDistBin(platform: NodeJS.Platform): string {
  if (platform === "darwin") return join("Electron.app", "Contents", "MacOS", "Electron");
  return platform === "win32" ? "electron.exe" : "electron";
}

/** 平台产物文件名（@electron/get getArtifactFileName 同构：electron-v<版>-<平台>-<arch>.zip） */
export function artifactName(platform: NodeJS.Platform, arch: string, version = ELECTRON_VERSION): string {
  return `electron-v${version}-${platform}-${arch}.zip`;
}

/** 官方 URL（默认基址 + v 前缀目录——@electron/get 默认拼装同构） */
export function officialUrl(name: string, version = ELECTRON_VERSION): string {
  return `${OFFICIAL_BASE}/v${version}/${name}`;
}

/** 镜像回落 URL（npmmirror；与官方只差基址——校验源不变） */
export function mirrorUrl(name: string, version = ELECTRON_VERSION): string {
  return `${NPMMIRROR_BASE}/v${version}/${name}`;
}

/** 注入面（测试 fake 网络面/解压器/主目录；缺省真实现） */
export interface ElectronGetDeps {
  download?(version: string, options?: ElectronDownloadRequestOptions): Promise<string>;
  extract?(zipPath: string, destDir: string): Promise<void>;
  homeDir?(): string;
  platform?: NodeJS.Platform;
  arch?: string;
}

/** 首启进度快照（P1 D7：rpc petSetupProgress 查询面；模块级单例——装配层后台获取时记录） */
export interface ElectronSetupPhase {
  phase: "idle" | "downloading" | "extracting" | "done" | "failed";
  at: number;
}

let setupPhase: ElectronSetupPhase = { phase: "idle", at: 0 };

/** 当前进度快照（客户端设置面「显示桌宠」行轮询消费） */
export function electronSetupProgress(): ElectronSetupPhase {
  return setupPhase;
}

function mark(phase: ElectronSetupPhase["phase"]): void {
  setupPhase = { phase, at: Date.now() };
}

export type EnsureElectronResult =
  | { status: "present"; binPath: string }
  | { status: "installed"; binPath: string }
  | { status: "failed"; reason: string; guidance: string };

interface GetContext {
  distRoot: string;
  distDir: string;
  binPath: string;
  distBin: string;
  name: string;
  checksum: string;
}

/** 确保 `~/.dsh/electron/dist/<平台二进制>` 在位：已存在 → present；否则下载（官方 → 镜像
 * 回落）+ 校验（内嵌常量）+ 解压原子落位；任何失败 → failed + 手动放置指引（不静默）。 */
export async function ensureElectronDist(deps: ElectronGetDeps = {}): Promise<EnsureElectronResult> {
  const ctx = resolveContext(deps);
  if (isRegularFile(ctx.binPath)) {
    mark("done");
    return { status: "present", binPath: ctx.binPath };
  }
  mkdirSync(ctx.distRoot, { recursive: true });
  mark("downloading");
  const zipPath = await downloadWithFallback(ctx, deps);
  if (zipPath === null) {
    mark("failed");
    return failed(ctx, "download-or-checksum-failed");
  }
  mark("extracting");
  if (!(await extractAndPlace(ctx, deps, zipPath))) {
    mark("failed");
    return failed(ctx, "extract-or-place-failed");
  }
  mark("done");
  return { status: "installed", binPath: ctx.binPath };
}

function resolveContext(deps: ElectronGetDeps): GetContext {
  const home = (deps.homeDir ?? homedir)();
  const platform = deps.platform ?? process.platform;
  const name = artifactName(platform, deps.arch ?? process.arch);
  const distBin = electronDistBin(platform);
  const distDir = join(home, ".dsh", "electron", "dist");
  return {
    distRoot: join(home, ".dsh", "electron"),
    distDir,
    distBin,
    binPath: join(distDir, distBin),
    name,
    checksum: ELECTRON_CHECKSUMS[name] ?? "",
  };
}

/** 下载 + 严格校验：官方 → 失败回落镜像（只换 URL）；校验值恒为内嵌常量（checksums 传入
 * 后 @electron/get 不从镜像拉 SHASUMS）。校验不过两侧都抛错 → null（failed + 指引）。 */
async function downloadWithFallback(ctx: GetContext, deps: ElectronGetDeps): Promise<string | null> {
  const doDownload =
    deps.download ?? ((version: string, options?: ElectronDownloadRequestOptions) => download(version, options));
  const base: ElectronDownloadRequestOptions = {
    checksums: { ...ELECTRON_CHECKSUMS },
    cacheRoot: join(ctx.distRoot, "cache"),
  };
  try {
    return await doDownload(ELECTRON_VERSION, base);
  } catch {
    return doDownload(ELECTRON_VERSION, { ...base, mirrorOptions: { mirror: NPMMIRROR_BASE } }).catch(() => null);
  }
}

/** 解压 + 原子落位：staging 解压 → 校验平台二进制在场 → rename 顶替 dist；失败清理 staging */
async function extractAndPlace(ctx: GetContext, deps: ElectronGetDeps, zipPath: string): Promise<boolean> {
  const staging = join(ctx.distRoot, ".dist-staging");
  rmSync(staging, { recursive: true, force: true });
  try {
    const extract = deps.extract ?? systemExtract;
    await extract(zipPath, staging);
    if (!isRegularFile(join(staging, ctx.distBin))) {
      return false;
    }
    rmSync(ctx.distDir, { recursive: true, force: true });
    renameSync(staging, ctx.distDir);
    return true;
  } catch {
    return false;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** 系统解压器：unzip 优先（darwin/linux 常见），bsdtar 兜底（Windows 10+ 自带，可读 zip） */
async function systemExtract(zipPath: string, destDir: string): Promise<void> {
  mkdirSync(destDir, { recursive: true });
  const commands: Array<[string, string[]]> = [
    ["unzip", ["-q", zipPath, "-d", destDir]],
    ["tar", ["-xf", zipPath, "-C", destDir]],
  ];
  let lastError: unknown = new Error("无可用解压器（unzip / tar）");
  for (const [bin, args] of commands) {
    try {
      await runCommand(bin, args);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function runCommand(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${bin} 退出码 ${code}`))));
  });
}

/** 失败出口：原因 + 手动放置指引（下载 URL/镜像/校验值/落位路径全给出——离线可达） */
function failed(ctx: GetContext, reason: string): EnsureElectronResult {
  const guidance =
    `Electron 运行时自动获取失败（${reason}）。手动放置：下载 ${officialUrl(ctx.name)}` +
    `（或镜像 ${mirrorUrl(ctx.name)}，SHA-256 = ${ctx.checksum}），解压到 ${ctx.distDir}，` +
    `确保 ${ctx.binPath} 存在后重试。`;
  return { status: "failed", reason, guidance };
}

function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
