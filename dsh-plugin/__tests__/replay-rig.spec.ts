/**
 * commands/replayRig · replayCommandLine（desktop history_invocation 本机分支 +
 * adapt_history_args 同构）：resume 分支按 kind 注入会话 id（claude --resume /
 * pi --session-id / 其他 kind 不强插）、自配旗标紧跟插值、tmux 分支优先、工作目录 cd 前缀；
 * dsh 类 agent 整行换 dst（`dst --resume <id>` / picker 裸 dst——dsh 本体无续接旗标）。
 * sshAliasReplayLine / launchRemote：本机终端注入面在场时远端回放弹 ssh 别名窗口。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { replayCommandLine, replayLauncherOf, sshAliasReplayLine } from "../src/host/commands/replayRig";
import type { HostCommandDeps } from "../src/host/commands/context";
import type { LocalReplayLaunch, RemoteReplayLaunch } from "../src/host/dispatch/sessions";
import { createTestDb, type TestDb } from "./helpers";

function launch(over: Partial<LocalReplayLaunch>): LocalReplayLaunch {
  return {
    branch: "resume",
    agentId: "ag-1",
    agentCommand: "claude",
    historyArgs: "",
    sessionId: "sess-1",
    tmuxSession: null,
    workdir: "",
    ...over,
  };
}

function remoteLaunch(over: Partial<RemoteReplayLaunch>): RemoteReplayLaunch {
  return {
    ...launch({}),
    target: "dev-box",
    deploymentAlias: "dev-box",
    workdir: "/srv/app",
    port: 0,
    keyPath: "",
    ...over,
  };
}

describe("replayCommandLine · resume 分支按 kind 注入会话 id", () => {
  it("claude → --resume；pi → --session-id；未知 kind 不强插", () => {
    expect(replayCommandLine(launch({ agentCommand: "claude" }))).toBe("claude --resume sess-1");
    expect(replayCommandLine(launch({ agentCommand: "pi" }))).toBe("pi --session-id sess-1");
    expect(replayCommandLine(launch({ agentCommand: "my-agent", historyArgs: "history" }))).toBe("my-agent history");
  });

  it("历史参数已配旗标：紧跟其后插值（后续用户开关不被挤丢）", () => {
    expect(replayCommandLine(launch({ agentCommand: "pi", historyArgs: "--session-id --verbose" }))).toBe(
      "pi --session-id sess-1 --verbose",
    );
    expect(replayCommandLine(launch({ agentCommand: "claude", historyArgs: "--resume --verbose" }))).toBe(
      "claude --resume sess-1 --verbose",
    );
  });

  it("tmux 分支优先 attach；工作目录非空加 cd 前缀；picker 分支不注入", () => {
    expect(replayCommandLine(launch({ branch: "tmux", tmuxSession: "pky-7" }))).toBe("tmux attach-session -t pky-7");
    expect(replayCommandLine(launch({ agentCommand: "claude", workdir: "/w s" }))).toBe(
      "cd '/w s' && claude --resume sess-1",
    );
    expect(replayCommandLine(launch({ branch: "picker", agentCommand: "claude", historyArgs: "--resume" }))).toBe(
      "claude --resume",
    );
  });

  it("picker 兜底实义：claude/pi 历史参数无旗标时补不带值的 --resume（agent 自带会话选择器——裸命令是开新会话）", () => {
    expect(replayCommandLine(launch({ branch: "picker", agentCommand: "claude", sessionId: null }))).toBe(
      "claude --resume",
    );
    expect(replayCommandLine(launch({ branch: "picker", agentCommand: "pi", sessionId: null }))).toBe("pi --resume");
    // 已配选择器/续接旗标族 → 不重复补
    expect(replayCommandLine(launch({ branch: "picker", agentCommand: "claude", historyArgs: "-r" }))).toBe(
      "claude -r",
    );
    expect(
      replayCommandLine(launch({ branch: "picker", agentCommand: "claude", historyArgs: "--resume-picker" })),
    ).toBe("claude --resume-picker");
    // 未知 kind 无可靠续接语义 → 裸命令不强插
    expect(replayCommandLine(launch({ branch: "picker", agentCommand: "my-agent", sessionId: null }))).toBe("my-agent");
  });
});

describe("replayCommandLine · dsh 类 agent 整行换 dst（dsh 本体无续接旗标）", () => {
  it("resume → `dst --resume <id>`（历史参数与 --session-id 旗标一并弃用）；picker → 裸 dst 会话管理器；tmux 不变", () => {
    expect(
      replayCommandLine(launch({ agentCommand: "dsh", historyArgs: "--profile headless", sessionId: "session-9" })),
    ).toBe("dst --resume session-9");
    expect(
      replayCommandLine(launch({ agentCommand: "dsh", historyArgs: "--profile headless --session-id --json" })),
    ).toBe("dst --resume sess-1");
    expect(
      replayCommandLine(launch({ branch: "picker", agentCommand: "/opt/homebrew/bin/dst", sessionId: null })),
    ).toBe("dst");
    expect(replayCommandLine(launch({ branch: "tmux", agentCommand: "dsh", tmuxSession: "pky-7" }))).toBe(
      "tmux attach-session -t pky-7",
    );
  });

  it("工作目录 cd 前缀照常织入（dst 不走位置参数）", () => {
    expect(replayCommandLine(launch({ agentCommand: "dsh", workdir: "/w s" }))).toBe(
      "cd '/w s' && dst --resume sess-1",
    );
  });
});

describe("sshAliasReplayLine · ssh 别名包装（载荷自携单引号）", () => {
  it("别名 + 远端 cd 载荷 + 快照 port/key 随行", () => {
    expect(sshAliasReplayLine(remoteLaunch({}))).toBe(
      `ssh -tt -o ConnectTimeout=10 -- dev-box exec '"$SHELL"' -l -c ''\\''cd /srv/app && claude --resume sess-1'\\'''`,
    );
    const line = sshAliasReplayLine(remoteLaunch({ port: 2222, keyPath: "~/.ssh/id_dev" }));
    expect(line).toContain("-i '~/.ssh/id_dev' -p 2222 -- dev-box");
    expect(sshAliasReplayLine(remoteLaunch({ port: 22 }))).not.toContain("-p 22");
  });
});

describe("replayLauncherOf · 远端部署回放双形态", () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb();
  });
  afterEach(() => {
    db.close();
  });

  it("本机终端注入面在场 → 弹 ssh 别名窗口（不进部署 PTY 链）", async () => {
    const lines: string[] = [];
    const deps = {
      conn: db.conn,
      terminalLine: { injectLine: async (line: string) => void lines.push(line) },
    } as unknown as HostCommandDeps;
    const rig = replayLauncherOf(deps);
    rig.launcher.launchRemote(remoteLaunch({ agentCommand: "dsh", sessionId: "s-9" }));
    await rig.settle();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("ssh -tt -o ConnectTimeout=10 -- dev-box");
    expect(lines[0]).toContain("cd /srv/app && dst --resume s-9");
    expect(rig.localHandoff()).toBeNull();
  });

  it("注入面缺席 → 走部署 PTY 链（远程平台面未装配折 SSH_AUTH_REQUIRED）", async () => {
    const rig = replayLauncherOf({ conn: db.conn } as unknown as HostCommandDeps);
    rig.launcher.launchRemote(remoteLaunch({}));
    await expect(rig.settle()).rejects.toMatchObject({ code: "SSH_AUTH_REQUIRED" });
  });
});
