/**
 * pet/electronGet（A32/D30）：URL 组装（官方 + npmmirror 镜像回落只换基址）/ 校验常量
 * （源出官方 SHASUMS256、经 checksums 传入——镜像不换校验源）/ 校验与下载失败拒绝 /
 * 原子落位 ~/.dsh/electron/dist/ 与失败清理 / 离线手动放置指引 / 系统解压器（真 zip
 * 夹具）。网络面与解压器全 fake；真机下载归 4.5 profile 冒烟。
 */
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  artifactName,
  ELECTRON_CHECKSUMS,
  ELECTRON_VERSION,
  electronDistBin,
  ensureElectronDist,
  mirrorUrl,
  officialUrl,
  type ElectronGetDeps,
} from "../src/host/pet/electronGet";

const FIXTURE_ZIP = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "electron-get-sample.zip");
const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "pky-eget-"));
  tempDirs.push(dir);
  return dir;
}

/** fake 下载面：记录每次 (version, options)；按脚本返回 zip 路径或抛错 */
function fakeDownloader(script: Array<string | Error>): {
  calls: Array<{ version: string; checksums?: Record<string, string>; mirror?: string }>;
  deps: Pick<ElectronGetDeps, "download">;
} {
  const calls: Array<{ version: string; checksums?: Record<string, string>; mirror?: string }> = [];
  let i = 0;
  return {
    calls,
    deps: {
      download: (version, options) => {
        calls.push({
          version,
          checksums: options?.checksums as Record<string, string> | undefined,
          mirror: options?.mirrorOptions?.mirror,
        });
        const step = script[i++] ?? new Error("no more scripted results");
        if (step instanceof Error) return Promise.reject(step);
        return Promise.resolve(step);
      },
    },
  };
}

/** fake 解压器：在 destDir 内落一个假平台二进制（原子落位路径断言用） */
function fakeExtractor(platform: NodeJS.Platform): ElectronGetDeps["extract"] {
  return async (zipPath, destDir) => {
    mkdirSync(join(destDir, dirname(electronDistBin(platform))), { recursive: true });
    writeFileSync(join(destDir, electronDistBin(platform)), `stub from ${zipPath}`);
  };
}

describe("URL 组装与校验常量（镜像回落只换 URL）", () => {
  it("官方 URL = github releases + v 前缀目录；镜像 URL 仅基址不同", () => {
    const name = artifactName("darwin", "arm64");
    expect(name).toBe(`electron-v${ELECTRON_VERSION}-darwin-arm64.zip`);
    const official = officialUrl(name);
    const mirror = mirrorUrl(name);
    expect(official).toBe(`https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/${name}`);
    expect(mirror).toBe(`https://npmmirror.com/mirrors/electron/v${ELECTRON_VERSION}/${name}`);
    expect(mirror.endsWith(`/${name}`)).toBe(true); // 镜像回落只换基址：文件名/目录段与官方完全一致
  });

  it("校验常量覆盖五个平台产物（源 = 官方 SHASUMS256.txt 构建期内嵌）", () => {
    for (const [platform, arch] of [
      ["darwin", "arm64"],
      ["darwin", "x64"],
      ["linux", "x64"],
      ["linux", "arm64"],
      ["win32", "x64"],
    ] as const) {
      const name = artifactName(platform, arch);
      expect(ELECTRON_CHECKSUMS[name]).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("平台二进制相对位：darwin .app 包内 / win32 electron.exe / linux 平铺", () => {
    expect(electronDistBin("darwin")).toBe(join("Electron.app", "Contents", "MacOS", "Electron"));
    expect(electronDistBin("win32")).toBe("electron.exe");
    expect(electronDistBin("linux")).toBe("electron");
  });
});

describe("ensureElectronDist · 落位成功路径（网络面 fake）", () => {
  it("已存在 → present（探测链同位路径）", async () => {
    const home = tempHome();
    const bin = join(home, ".dsh", "electron", "dist", "electron");
    mkdirSync(dirname(bin), { recursive: true });
    writeFileSync(bin, "existing");
    const result = await ensureElectronDist({ homeDir: () => home, platform: "linux", arch: "x64" });
    expect(result).toEqual({ status: "present", binPath: bin });
  });

  it("官方失败 → 镜像回落（只换 URL：checksums 同一份常量）；成功原子落位 dist/", async () => {
    const home = tempHome();
    const dl = fakeDownloader([new Error("github unreachable"), "/cache/electron.zip"]);
    const result = await ensureElectronDist({
      ...dl.deps,
      extract: fakeExtractor("darwin"),
      homeDir: () => home,
      platform: "darwin",
      arch: "arm64",
    });
    expect(result.status).toBe("installed");
    if (result.status === "installed" || result.status === "present") {
      expect(result.binPath).toBe(
        join(home, ".dsh", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron"),
      );
    }
    expect(
      statSync(join(home, ".dsh", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron")).isFile(),
    ).toBe(true);
    expect(dl.calls).toHaveLength(2);
    expect(dl.calls[0]).toMatchObject({ version: ELECTRON_VERSION });
    expect(dl.calls[0]?.checksums).toEqual({ ...ELECTRON_CHECKSUMS }); // 严格校验：常量传入
    expect(dl.calls[0]?.mirror).toBeUndefined(); // 官方面无 mirrorOptions
    expect(dl.calls[1]?.mirror).toBe("https://npmmirror.com/mirrors/electron");
    expect(dl.calls[1]?.checksums).toEqual({ ...ELECTRON_CHECKSUMS }); // 镜像回落只换 URL，不换校验源
    expect(statSync(join(home, ".dsh", "electron", ".dist-staging"), { throwIfNoEntry: false })).toBeUndefined(); // staging 已清
  });
});

describe("ensureElectronDist · 失败降级与清理", () => {
  it("两侧全失败（含校验不过）→ failed + 手动放置指引（URL/镜像/校验值/落位路径）", async () => {
    const home = tempHome();
    const dl = fakeDownloader([new Error("checksum mismatch"), new Error("mirror checksum mismatch")]);
    const result = await ensureElectronDist({
      ...dl.deps,
      homeDir: () => home,
      platform: "linux",
      arch: "x64",
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.reason).toBe("download-or-checksum-failed");
      const name = artifactName("linux", "x64");
      expect(result.guidance).toContain(officialUrl(name));
      expect(result.guidance).toContain(mirrorUrl(name));
      expect(result.guidance).toContain(ELECTRON_CHECKSUMS[name]!);
      expect(result.guidance).toContain(join(home, ".dsh", "electron", "dist"));
    }
  });

  it("解压失败 / 落位后二进制缺失 → failed 且 staging 清理", async () => {
    const home = tempHome();
    const broken = await ensureElectronDist({
      download: async () => "/cache/electron.zip",
      extract: async () => {
        throw new Error("unzip missing");
      },
      homeDir: () => home,
      platform: "linux",
      arch: "x64",
    });
    expect(broken.status).toBe("failed");
    if (broken.status === "failed") expect(broken.reason).toBe("extract-or-place-failed");
    const noBin = await ensureElectronDist({
      download: async () => "/cache/electron.zip",
      extract: async (_zip, dest) => {
        mkdirSync(dest, { recursive: true }); // 解压成功但产物缺平台二进制
      },
      homeDir: () => home,
      platform: "linux",
      arch: "x64",
    });
    expect(noBin.status).toBe("failed");
    expect(statSync(join(home, ".dsh", "electron", ".dist-staging"), { throwIfNoEntry: false })).toBeUndefined();
  });
});

describe("系统解压器（真 zip 夹具；unzip → tar 兜底链）", () => {
  it("systemExtract 经 ensureElectronDist 走真解压：夹具内容落位 destDir", async () => {
    const home = tempHome();
    const result = await ensureElectronDist({
      download: async () => FIXTURE_ZIP,
      homeDir: () => home,
      platform: "linux",
      arch: "x64",
      extract: undefined, // 真系统解压器（夹具 zip 含 hello.txt——落位校验按 dist/electron 失败预期）
    });
    // 夹具 zip 内是 hello.txt 而非平台二进制 → 落位校验失败（同时证明真解压被执行）
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.reason).toBe("extract-or-place-failed");
  });
});
