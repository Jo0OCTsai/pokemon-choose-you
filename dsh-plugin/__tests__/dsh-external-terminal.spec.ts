/**
 * dsh/externalTerminal · 外部终端唤起（debt ③ a 的本机载体解 + 终端偏好遵循）：
 * 插件宿主跑在用户这台 Mac 上（dsh 桌面 app / dsh web / dsh-tui——载体判据 = darwin，
 * 不再要求 Electron 在场）在本机探测 GUI 终端（kitty → Ghostty → Alacritty → WezTerm →
 * iTerm2 → Terminal.app 兜底）唤起真窗口执行派发/回放命令行；kitty 首位因 tab 复用
 * （socket 在场 → kitten @ launch --type=tab 复用最近活跃窗口；缺席/失败 → open -na 自举
 * 带 socket 的新实例——listen socket 只认启动旗标，kitty.conf 的 listen_on 不生效）。共享
 * 设置 terminal_preference（值域对齐主应用 + dsh 增设 kitty）命中且已安装时优先于探测链
 * （未装/未知值/default → 链回落）；未装任何候选终端 → null（回落 handoff 复制）。
 * macOS 优先（仓库载体 macos）；其余平台 → null。
 */
import { describe, expect, it } from "vitest";
import { detectExternalTerminal } from "../src/host/dsh/externalTerminal";
import { createExternalTerminalAdapter, externalTerminalLine } from "../src/host/dsh/externalTerminalAdapter";
import { fakeEnv, TEST_AGENT } from "./dshExternalTerminalFakes";

/** kitten @ launch 复用 argv 公共前缀（--to socket + tab 形态 + 登录 shell 执行） */
const KITTEN_TAB_ARGV = [
  "/Applications/kitty.app/Contents/MacOS/kitten",
  "@",
  "--to",
  "unix:/tmp/kitty.sock",
  "launch",
  "--type=tab",
  "/bin/zsh",
  "-i",
  "-l",
  "-c",
] as const;

/** open -na kitty 自举 argv 公共前缀（listen-on/override 旗标 + 登录 shell 执行） */
const OPEN_BOOT_ARGV = [
  "open",
  "-na",
  "kitty",
  "--args",
  "--listen-on=unix:/tmp/kitty.sock",
  "--override=allow_remote_control=socket-only",
  "/bin/zsh",
  "-i",
  "-l",
  "-c",
] as const;

describe("载体与探测链", () => {
  it("闸门只看平台：非 Electron 的 darwin 宿主（vitest 进程无 electron）有产物；未装候选终端 → null；非 macOS → null", () => {
    expect(process.versions.electron).toBeUndefined();
    expect(detectExternalTerminal({ platform: "darwin", appExists: (name) => name === "Ghostty" })?.label).toBe(
      "Ghostty",
    );
    expect(detectExternalTerminal(fakeEnv({ appExists: () => false }).env)).toBeNull();
    expect(detectExternalTerminal(fakeEnv({ platform: "linux", appExists: () => true }).env)).toBeNull();
  });

  it("Ghostty 在场 → 首选；spawn 经 open -na，工作目录织入用户登录 shell 单串执行", async () => {
    const { env, spawned } = fakeEnv({ appExists: (name) => name === "Ghostty" });
    const ext = detectExternalTerminal(env);
    expect(ext?.label).toBe("Ghostty");
    await ext?.spawn("claude --resume s1", "/ws/project");
    expect(spawned[0]).toEqual([
      "open",
      "-na",
      "Ghostty",
      "--args",
      "-e",
      "/bin/zsh",
      "-i",
      "-l",
      "-c",
      "cd /ws/project && claude --resume s1",
    ]);
    // workdir 空 = 不织入 cd
    await ext?.spawn("claude --resume s1", null);
    expect(spawned[1]?.[9]).toBe("claude --resume s1");
  });

  it("探测链顺序兜底：Ghostty 缺、kitty 在 → kitty 形态；全缺 → Terminal.app osascript 兜底", async () => {
    const kittyEnv = fakeEnv({ appExists: (name) => name === "kitty" });
    expect(detectExternalTerminal(kittyEnv.env)?.label).toBe("kitty");
    const { env: osaEnv, spawned: osaSpawned } = fakeEnv({ appExists: (name) => name === "Terminal" });
    const osa = detectExternalTerminal(osaEnv);
    expect(osa?.label).toBe("Terminal");
    await osa?.spawn("claude --resume s1", null);
    expect(osaSpawned[0]?.[0]).toBe("osascript");
    expect(osaSpawned[0]?.[2]).toContain("do script");
    expect(osaSpawned[0]?.[2]).toContain("claude --resume s1");
  });

  it("探测链序：Ghostty 与 iTerm2 皆在场 → Ghostty（open -na 免授权家族优先）", () => {
    const { env } = fakeEnv({ appExists: (name) => name === "Ghostty" || name === "iTerm2" });
    expect(detectExternalTerminal(env)?.label).toBe("Ghostty");
  });
});

describe("cd 前缀 · ~ 展开（quote_cd_target 同构）", () => {
  it("workdir ~/ 前缀：~ 裸写给 shell 展开——引号内 ~ 是字面量，整体引用 cd 必失败", async () => {
    const { env, spawned } = fakeEnv({ appExists: (name) => name === "Ghostty" });
    const ext = detectExternalTerminal(env);
    await ext?.spawn("claude --resume s1", "~/infra/dev-env-settings");
    expect(spawned[0]?.[9]).toBe("cd ~/infra/dev-env-settings && claude --resume s1");
    // 含空格目录：~ 保持裸写、其余部分引用（拼接后仍是可展开的 tilde 前缀词）
    await ext?.spawn("claude --resume s1", "~/My Dir");
    expect(spawned[1]?.[9]).toBe("cd ~/'My Dir' && claude --resume s1");
  });
});

describe("kitty · tab 复用与自举", () => {
  it("探测链首位：kitty 与 Ghostty 皆在场 → kitty（tab 复用能力优先）", () => {
    const { env } = fakeEnv({ appExists: () => true });
    expect(detectExternalTerminal(env)?.label).toBe("kitty");
  });

  it("socket 在场 → kitten @ launch --type=tab 复用最近活跃窗口（form=tab；workdir 织入 cd）", async () => {
    const { env, spawned } = fakeEnv({ appExists: (name) => name === "kitty", socketExists: () => true });
    const ext = detectExternalTerminal(env);
    await ext?.spawn("claude --resume s1", "/ws/project");
    expect(spawned[0]).toEqual([...KITTEN_TAB_ARGV, "cd /ws/project && claude --resume s1"]);
    // workdir 空 = 不织入 cd
    await ext?.spawn("claude --resume s1", null);
    expect(spawned[1]?.[10]).toBe("claude --resume s1");
  });

  it("socket 缺席 → open -na 自举：--listen-on/--override 旗标随启动传递（form=window）", async () => {
    const { env, spawned, unlinked } = fakeEnv({ appExists: (name) => name === "kitty" });
    const ext = detectExternalTerminal(env);
    const form = await ext?.spawn("claude --resume s1", null);
    expect(form).toBe("window");
    expect(spawned[0]).toEqual([...OPEN_BOOT_ARGV, "claude --resume s1"]);
    expect(unlinked).toEqual([]);
  });
});

describe("kitty · 回落与失败", () => {
  it("tab 失败（陈旧 socket）→ 清残档回落自举；自举也失败 → 上抛（适配器折 spawn-failed handoff）", async () => {
    const { env, spawned, unlinked } = fakeEnv({
      appExists: (name) => name === "kitty",
      socketExists: () => true,
      spawn: async (argv) => {
        spawned.push(argv);
        if (spawned.length === 1) {
          throw new Error("connect: no such file or directory");
        }
      },
    });
    const ext = detectExternalTerminal(env);
    const form = await ext?.spawn("claude --resume s1", null);
    expect(form).toBe("window");
    expect(unlinked).toEqual(["/tmp/kitty.sock"]);
    expect(spawned[1]?.[0]).toBe("open");
    // 全链失败：tab 与自举皆抛 → spawn reject
    const failing = detectExternalTerminal(
      fakeEnv({
        appExists: (name) => name === "kitty",
        spawn: async () => Promise.reject(new Error("boom")),
      }).env,
    );
    await expect(failing?.spawn("claude --resume s1", null)).rejects.toThrowError("boom");
  });
});

describe("探测链 · iTerm2（AppleScript 家族）", () => {
  it("iTerm2 进探测链（open 家族之后、Terminal.app 之前）：AppleScript 多 -e 建窗写命令行", async () => {
    const { env, spawned } = fakeEnv({ appExists: (name) => name === "iTerm2" });
    const ext = detectExternalTerminal(env);
    expect(ext?.label).toBe("iTerm2");
    await ext?.spawn("claude --resume s1", "/ws");
    // argv = osascript -e <逐行>（与主应用 iterm2_script_lines 同构：activate + create window + write text）
    expect(spawned[0]?.[0]).toBe("osascript");
    const script = spawned[0]?.filter((_, i) => i >= 2 && i % 2 === 0).join("\n");
    expect(script).toContain('tell application "iTerm2"');
    expect(script).toContain("create window with default profile");
    expect(script).toContain("write text");
    expect(script).toContain("claude --resume s1");
    expect(script).toContain("cd /ws && claude --resume s1"); // workdir 织入写进首行命令（主应用 cd 前缀同构）
  });
});

describe("TerminalAdapter · 真窗口唤起", () => {
  it("适配器：唤起成功 → external-<label> 且无 sessionRef（不落假句柄）", async () => {
    const { env } = fakeEnv({ appExists: (name) => name === "Ghostty" });
    const adapter = createExternalTerminalAdapter(env);
    const out = await adapter.inject({
      line: "claude --resume s1",
      agent: TEST_AGENT,
      taskId: 1,
      workdir: "/ws",
    });
    expect(out.terminal).toBe("external-Ghostty");
    expect(out.sessionRef).toBeUndefined();
    expect(out.note).toBeUndefined();
  });

  it("适配器：kitty tab 命中 → external-kitty@tab；自举 → external-kitty（形态可观察）", async () => {
    const tab = fakeEnv({ appExists: (name) => name === "kitty", socketExists: () => true });
    const tabOut = await createExternalTerminalAdapter(tab.env).inject({
      line: "claude --resume s1",
      agent: TEST_AGENT,
      taskId: 1,
      workdir: null,
    });
    expect(tabOut.terminal).toBe("external-kitty@tab");
    const win = fakeEnv({ appExists: (name) => name === "kitty" });
    const winOut = await createExternalTerminalAdapter(win.env).inject({
      line: "claude --resume s1",
      agent: TEST_AGENT,
      taskId: 1,
      workdir: null,
    });
    expect(winOut.terminal).toBe("external-kitty");
  });

  it("适配器：inject 携带 terminalPreference → 按次解析命中偏好终端", async () => {
    const { env, spawned } = fakeEnv({ appExists: (name) => name === "Ghostty" || name === "iTerm2" });
    const adapter = createExternalTerminalAdapter(env);
    const out = await adapter.inject({
      line: "claude --resume s1",
      agent: TEST_AGENT,
      taskId: 1,
      workdir: null,
      terminalPreference: "iterm2",
    });
    expect(out.terminal).toBe("external-iTerm2");
    expect(spawned[0]?.[0]).toBe("osascript");
  });
});

describe("TerminalAdapter · handoff 降级", () => {
  it("适配器：唤起失败 → copy-line handoff（reason=spawn-failed，note 携带命令行）", async () => {
    const { env } = fakeEnv({
      appExists: (name) => name === "Ghostty",
      spawn: async () => Promise.reject(new Error("open 退出码 1")),
    });
    const adapter = createExternalTerminalAdapter(env);
    const out = await adapter.inject({
      line: "claude --resume s1",
      agent: TEST_AGENT,
      taskId: 1,
      workdir: null,
    });
    expect(out.terminal).toBe("copy-line");
    expect(out.reason).toBe("spawn-failed");
    expect(out.note).toContain("claude --resume s1");
  });

  it("适配器：desktop 载体但无任何可用终端 → copy-line handoff（reason=no-terminal）", async () => {
    const { env } = fakeEnv({ appExists: () => false });
    const adapter = createExternalTerminalAdapter(env);
    const out = await adapter.inject({
      line: "claude --resume s1",
      agent: TEST_AGENT,
      taskId: 1,
      workdir: null,
    });
    expect(out.terminal).toBe("copy-line");
    expect(out.reason).toBe("no-terminal");
    expect(out.note).toContain("claude --resume s1");
  });
});

describe("TerminalAdapter · 本机 pk PATH 前缀（登录 shell 不吃 childEnvFor 注入）", () => {
  it("落位在场：注入行前插 export PATH（cd 织入在前，真窗口执行与 copy-line 手动粘贴同源）", async () => {
    const prefix = `export PATH='/x/.choose-you/bin':"$PATH" && `;
    const { env, spawned } = fakeEnv({ appExists: (name) => name === "Ghostty" });
    await createExternalTerminalAdapter(env, () => prefix).inject({
      line: "claude --resume s1",
      agent: TEST_AGENT,
      taskId: 1,
      workdir: "/ws",
    });
    expect(spawned[0]?.[9]).toBe(`cd /ws && ${prefix}claude --resume s1`);
    const failing = fakeEnv({
      appExists: (name) => name === "Ghostty",
      spawn: async () => Promise.reject(new Error("boom")),
    });
    const out = await createExternalTerminalAdapter(failing.env, () => prefix).inject({
      line: "claude",
      agent: TEST_AGENT,
      taskId: 1,
      workdir: null,
    });
    expect(out.note).toContain(`${prefix}claude`);
  });

  it("落位缺席（空串前缀）：行为不变——裸命令行直通", async () => {
    const { env, spawned } = fakeEnv({ appExists: (name) => name === "Ghostty" });
    await createExternalTerminalAdapter(env, () => "").inject({
      line: "claude",
      agent: TEST_AGENT,
      taskId: 1,
      workdir: null,
    });
    expect(spawned[0]?.[9]).toBe("claude");
  });
});

describe("terminalLine 注入件", () => {
  it("行直通 spawn 且随偏好解析；失败上抛（回放经 injectLineGuarded 折 DISPATCH_LAUNCH_FAILED）", async () => {
    const { env, spawned } = fakeEnv({ appExists: (name) => name === "Ghostty" || name === "iTerm2" });
    const injector = externalTerminalLine(env);
    await injector.injectLine("tmux attach-session -t t1");
    expect(spawned[0]?.[9]).toBe("tmux attach-session -t t1");
    await injector.injectLine("tmux attach-session -t t1", "iterm2");
    expect(spawned[1]?.[0]).toBe("osascript");
    const failing = externalTerminalLine(
      fakeEnv({
        appExists: (name) => name === "Ghostty",
        spawn: async () => Promise.reject(new Error("boom")),
      }).env,
    );
    await expect(failing.injectLine("x")).rejects.toThrowError("boom");
  });
});
