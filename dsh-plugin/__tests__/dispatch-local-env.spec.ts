/**
 * dispatch/localEnv：本地子进程环境解析（src-tauri/src/which.rs + invocation.rs
 * agent_workdir 同构）——`~` 展开 / 裸命令名 PATH 补扫 / node 脚本宿主目录 / PATH 前插 /
 * 子进程环境组装 / spawn 失败指引。纯函数用临时 home 驱动，不碰真实 $HOME。
 *
 * 注：pathEnv / home 显式传 undefined 走 JS 默认参数（= 真实进程 PATH / homedir），
 * 用例一律用 "" 模拟 GUI 空 PATH 与无 home，避免被本机环境污染。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  augmentedPath,
  childEnvFor,
  expandHome,
  extraBinDirs,
  pathEnvKey,
  resolveCommand,
  scriptHostDirs,
  spawnErrorHint,
} from "../src/host/dispatch/localEnv";

/** 临时 home 夹具：三版 nvm bin 各放一个 lark-cli 脚本（v9 考字典序陷阱）+ 一个独立 PATH 目录 */
interface NvmHome {
  home: string;
  onPath: string;
  v9: string;
  v18: string;
  v20: string;
}

function makeNvmHome(): NvmHome {
  const home = mkdtempSync(join(tmpdir(), "pky-res-home-"));
  const onPath = mkdtempSync(join(tmpdir(), "pky-res-path-"));
  const bins = ["v9.0.0", "v18.20.0", "v20.11.1"].map((v) => join(home, ".nvm/versions/node", v, "bin"));
  for (const d of bins) {
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "lark-cli"), "#!/bin/sh\n");
  }
  const [v9, v18, v20] = bins as [string, string, string];
  return { home, onPath, v9, v18, v20 };
}

function dropNvmHome(h: NvmHome): void {
  rmSync(h.home, { recursive: true, force: true });
  rmSync(h.onPath, { recursive: true, force: true });
}

describe("expandHome（agent_workdir 同构：`~/` 前缀展开）", () => {
  it("~ 与 ~/x 展开为 home 下绝对路径；显式路径原样；空白 → undefined（继承宿主 cwd）", () => {
    expect(expandHome("~", "/h/u")).toBe("/h/u");
    expect(expandHome("~/.choose-you/workspace", "/h/u")).toBe(join("/h/u", ".choose-you/workspace"));
    expect(expandHome("  ~/x  ", "/h/u")).toBe(join("/h/u", "x"));
    expect(expandHome("/abs/dir", "/h/u")).toBe("/abs/dir");
    expect(expandHome("rel/dir", "/h/u")).toBe("rel/dir");
    expect(expandHome("~other/x", "/h/u")).toBe("~other/x"); // 仅 ~/ 前缀（strip_prefix 同语义）
    expect(expandHome("", "/h/u")).toBeUndefined();
    expect(expandHome("   ", "/h/u")).toBeUndefined();
    expect(expandHome(null, "/h/u")).toBeUndefined();
    expect(expandHome(undefined, "/h/u")).toBeUndefined();
  });
});

describe("resolveCommand（resolve_in 同构：进程 PATH 优先，再补扫 GUI 进程缺失目录）", () => {
  let h: NvmHome;
  beforeEach(() => {
    h = makeNvmHome();
  });
  afterEach(() => {
    dropNvmHome(h);
  });

  it("PATH 为空（GUI 进程）也能在 nvm 目录找到，多版本按数字段新版本优先（v20 > v18 > v9）", () => {
    expect(resolveCommand("lark-cli", "", h.home)).toBe(join(h.v20, "lark-cli"));
    expect(resolveCommand("lark-cli", "/nope", h.home)).toBe(join(h.v20, "lark-cli"));
  });

  it("进程 PATH 里的命中优先于补扫目录（多段 / 空段正常分割）", () => {
    writeFileSync(join(h.onPath, "lark-cli"), "#!/bin/sh\n");
    expect(resolveCommand("lark-cli", h.onPath, h.home)).toBe(join(h.onPath, "lark-cli"));
    expect(resolveCommand("lark-cli", `${delimiter}/nope${delimiter}${h.onPath}`, h.home)).toBe(
      join(h.onPath, "lark-cli"),
    );
  });

  it("显式路径与空名不改写；同名目录不算命中；哪都找不到原样返回交调用方报错", () => {
    expect(resolveCommand("/x/lark-cli", "", h.home)).toBe("/x/lark-cli");
    expect(resolveCommand("./lark-cli", "", h.home)).toBe("./lark-cli");
    expect(resolveCommand("", "", h.home)).toBe("");
    mkdirSync(join(h.onPath, "dir-not-bin"));
    expect(resolveCommand("dir-not-bin", h.onPath, h.home)).toBe("dir-not-bin");
    expect(resolveCommand("no-such-bin-xyz", "", h.home)).toBe("no-such-bin-xyz");
  });
});

describe("extraBinDirs（extra_bin_dirs_in 同构）", () => {
  it("系统目录 + 用户目录 + nvm 版本目录（新→旧）；无 home 仅系统目录", () => {
    const h = makeNvmHome();
    try {
      const dirs = extraBinDirs(h.home);
      expect(dirs.slice(0, 3)).toEqual(["/usr/local/bin", "/opt/homebrew/bin", "/home/linuxbrew/.linuxbrew/bin"]);
      for (const rel of [".npm-global/bin", ".volta/bin", ".asdf/shims", ".local/bin", "bin"]) {
        expect(dirs).toContain(join(h.home, rel));
      }
      expect(dirs.slice(-3)).toEqual([h.v20, h.v18, h.v9]);
      expect(extraBinDirs("")).toHaveLength(3);
    } finally {
      dropNvmHome(h);
    }
  });
});

describe("scriptHostDirs（script_host_dirs_in 同构：env node shebang 的宿主目录）", () => {
  it("脚本与 node 同目录去重为一；不同目录两个都收、脚本目录优先；裸名无父目录跳过", () => {
    expect(scriptHostDirs("/nvm/v20/bin/lark-cli", "/nvm/v20/bin/node")).toEqual(["/nvm/v20/bin"]);
    expect(scriptHostDirs("/nvm/v20/bin/lark-cli", "/usr/local/bin/node")).toEqual(["/nvm/v20/bin", "/usr/local/bin"]);
    expect(scriptHostDirs("lark-cli", "node")).toEqual([]);
    expect(scriptHostDirs("lark-cli", "/usr/local/bin/node")).toEqual(["/usr/local/bin"]);
  });
});

describe("augmentedPath（augmented_path 同构：补齐目录前插、原条目保留）", () => {
  it("无补齐目录 → undefined 不改写环境；有则排最前且 base 条目全保留", () => {
    expect(augmentedPath([], "/usr/bin:/bin")).toBeUndefined();
    const base = ["/usr/bin", "/bin"].join(delimiter);
    const got = augmentedPath(["/opt/app", "/opt/node"], base);
    expect(got).toBe(["/opt/app", "/opt/node", "/usr/bin", "/bin"].join(delimiter));
    // base 为空（极简环境）只剩补齐目录
    expect(augmentedPath(["/opt/app"], "")).toBe("/opt/app");
  });
});

describe("childEnvFor / spawnErrorHint（runner.rs run_agent / NotFound 指引同构）", () => {
  it("子进程 PATH：程序目录排最前、宿主 PATH 条目保留、extra 最后覆盖；沿用宿主 PATH 键名", () => {
    const key = pathEnvKey();
    const env = childEnvFor("/opt/agent/bin/claude", { PK_DISPATCH_TASK: "7" });
    const parts = (env[key] ?? "").split(delimiter);
    expect(parts[0]).toBe("/opt/agent/bin");
    for (const d of (process.env[key] ?? "").split(delimiter).filter((x) => x !== "")) {
      expect(parts).toContain(d);
    }
    expect(env.PK_DISPATCH_TASK).toBe("7");
    expect(pathEnvKey({ Path: "x" })).toBe("Path");
    expect(pathEnvKey({})).toBe("PATH");
  });

  it("ENOENT 附安装 / 工作目录 / 绝对路径指引；其他错误不加提示", () => {
    expect(spawnErrorHint("spawn dsh ENOENT")).toMatch(/工作目录/);
    expect(spawnErrorHint("spawn dsh ENOENT")).toMatch(/绝对路径/);
    expect(spawnErrorHint("spawn dsh EACCES")).toBe("");
  });
});
