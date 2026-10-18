/**
 * dsh/externalTerminal · 外部终端唤起（debt ③ a 的 desktop 载体解 + 终端偏好遵循）：
 * dsh 桌面 app（Electron 主进程承载插件宿主——process.versions.electron 载体判据）在
 * 本机探测 GUI 终端（kitty → Ghostty → Alacritty → WezTerm → iTerm2 → Terminal.app
 * 兜底）唤起真窗口执行派发/回放命令行；kitty 首位因 tab 复用（socket 在场 →
 * kitten @ launch --type=tab 复用最近活跃窗口；缺席/失败 → open -na 自举带 socket 的
 * 新实例——listen socket 只认启动旗标，kitty.conf 的 listen_on 不生效）。共享设置
 * terminal_preference（值域对齐主应用 + dsh 增设 kitty）命中且已安装时优先于探测链
 * （未装/未知值/default → 链回落）；web/headless CLI 载体 → null（回落 handoff 复制 +
 * 客户端 web 提示）。macOS 优先（仓库载体 macos）；其余平台 → null。
 */
import { describe, expect, it } from "vitest";
import {
  createExternalTerminalAdapter,
  detectExternalTerminal,
  externalTerminalLine,
  resolveExternalTerminal,
  type ExternalTerminalEnv,
} from "../src/host/dsh/externalTerminal";

/** 测试环境注入件：全部可控（探测存在性 / spawn 与 socket 操作记录） */
function fakeEnv(over: Partial<ExternalTerminalEnv> = {}): {
  env: ExternalTerminalEnv;
  spawned: string[][];
  unlinked: string[];
} {
  const spawned: string[][] = [];
  const unlinked: string[] = [];
  const env: ExternalTerminalEnv = {
    platform: "darwin",
    electron: true,
    appExists: () => false,
    spawn: async (argv) => {
      spawned.push(argv);
    },
    socketExists: () => false,
    unlinkSocket: (path) => {
      unlinked.push(path);
    },
    kittenPath: "/Applications/kitty.app/Contents/MacOS/kitten",
    shell: "/bin/zsh",
    ...over,
  };
  return { env, spawned, unlinked };
}

/** 适配器注入用 agent 配置（形状满足 AgentConfig） */
const TEST_AGENT = {
  id: "a",
  name: "A",
  command: "claude",
  args: "",
  historyArgs: "",
  workdir: "",
  timeoutSecs: 60,
  enabled: true,
};

describe("载体与探测链", () => {
  it("web/headless CLI 载体（非 Electron 宿主）→ null（回落 handoff + web 提示）", () => {
    expect(detectExternalTerminal(fakeEnv({ electron: false, appExists: () => true }).env)).toBeNull();
  });

  it("非 macOS 平台 → null（探测链仅 darwin 实装——仓库载体 macos）", () => {
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
    expect(spawned[0]).toEqual([
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
      "cd /ws/project && claude --resume s1",
    ]);
    // workdir 空 = 不织入 cd
    await ext?.spawn("claude --resume s1", null);
    expect(spawned[1]?.[10]).toBe("claude --resume s1");
  });

  it("socket 缺席 → open -na 自举：--listen-on/--override 旗标随启动传递（form=window）", async () => {
    const { env, spawned, unlinked } = fakeEnv({ appExists: (name) => name === "kitty" });
    const ext = detectExternalTerminal(env);
    const form = await ext?.spawn("claude --resume s1", null);
    expect(form).toBe("window");
    expect(spawned[0]).toEqual([
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
      "claude --resume s1",
    ]);
    expect(unlinked).toEqual([]);
  });

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

describe("终端偏好解析 · 命中优先", () => {
  it("偏好 iterm2 且已安装 → iTerm2（压过探测链首位 Ghostty）", () => {
    const { env } = fakeEnv({ appExists: (name) => name === "Ghostty" || name === "iTerm2" });
    expect(resolveExternalTerminal("iterm2", env)?.label).toBe("iTerm2");
  });

  it("偏好 ghostty → Ghostty（即使探测链更靠前的 kitty 也在场仍命中偏好）", () => {
    const { env } = fakeEnv({ appExists: (name) => name === "kitty" || name === "Ghostty" });
    expect(resolveExternalTerminal("ghostty", env)?.label).toBe("Ghostty");
  });

  it("偏好 kitty（dsh 增设值）→ kitty", () => {
    const { env } = fakeEnv({ appExists: (name) => name === "Ghostty" || name === "kitty" });
    expect(resolveExternalTerminal("kitty", env)?.label).toBe("kitty");
  });
});

describe("终端偏好解析 · 回落与闸门", () => {
  it("偏好的终端未安装 → 探测链回落（零中断）", () => {
    const { env } = fakeEnv({ appExists: (name) => name === "Ghostty" });
    expect(resolveExternalTerminal("iterm2", env)?.label).toBe("Ghostty");
  });

  it("default / 未设 / 未知值 / 平台不适值（windows-terminal@darwin）→ 探测链", () => {
    const { env } = fakeEnv({ appExists: (name) => name === "kitty" || name === "iTerm2" });
    expect(resolveExternalTerminal("default", env)?.label).toBe("kitty");
    expect(resolveExternalTerminal(null, env)?.label).toBe("kitty");
    expect(resolveExternalTerminal(undefined, env)?.label).toBe("kitty");
    expect(resolveExternalTerminal("made-up", env)?.label).toBe("kitty");
    expect(resolveExternalTerminal("windows-terminal", env)?.label).toBe("kitty");
  });
});

describe("终端偏好解析 · 载体闸门", () => {
  it("载体闸门同探测链：web 载体偏好也命中不了 → null", () => {
    const { env } = fakeEnv({ electron: false, appExists: () => true });
    expect(resolveExternalTerminal("ghostty", env)).toBeNull();
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
