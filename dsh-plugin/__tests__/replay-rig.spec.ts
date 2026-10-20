/**
 * commands/replayRig · replayCommandLine（desktop history_invocation 本机分支 +
 * adapt_history_args 同构）：resume 分支按 kind 注入会话 id（claude --resume /
 * pi --session-id / dsh --session-id adopt / 其他 kind 不强插）、自配旗标紧跟插值、
 * tmux 分支优先、工作目录 cd 前缀。
 */
import { describe, expect, it } from "vitest";
import { replayCommandLine } from "../src/host/commands/replayRig";
import type { LocalReplayLaunch } from "../src/host/dispatch/sessions";

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

describe("replayCommandLine · resume 分支按 kind 注入会话 id", () => {
  it("claude → --resume；pi → --session-id；dsh → --session-id（headless adopt 既有会话）；未知 kind 不强插", () => {
    expect(replayCommandLine(launch({ agentCommand: "claude" }))).toBe("claude --resume sess-1");
    expect(replayCommandLine(launch({ agentCommand: "pi" }))).toBe("pi --session-id sess-1");
    expect(
      replayCommandLine(launch({ agentCommand: "dsh", historyArgs: "--profile headless", sessionId: "session-9" })),
    ).toBe("dsh --profile headless --session-id session-9");
    expect(replayCommandLine(launch({ agentCommand: "my-agent", historyArgs: "history" }))).toBe("my-agent history");
  });

  it("历史参数已配旗标：紧跟其后插值（后续用户开关不被挤丢）", () => {
    expect(
      replayCommandLine(launch({ agentCommand: "dsh", historyArgs: "--profile headless --session-id --json" })),
    ).toBe("dsh --profile headless --session-id sess-1 --json");
    expect(replayCommandLine(launch({ agentCommand: "claude", historyArgs: "--resume --verbose" }))).toBe(
      "claude --resume sess-1 --verbose",
    );
  });

  it("tmux 分支优先 attach；工作目录非空加 cd 前缀；picker 分支不注入", () => {
    expect(replayCommandLine(launch({ branch: "tmux", tmuxSession: "pky-7" }))).toBe("tmux attach-session -t pky-7");
    expect(replayCommandLine(launch({ agentCommand: "dsh", historyArgs: "--profile headless", workdir: "/w s" }))).toBe(
      "cd '/w s' && dsh --profile headless --session-id sess-1",
    );
    expect(replayCommandLine(launch({ branch: "picker", agentCommand: "claude", historyArgs: "--resume" }))).toBe(
      "claude --resume",
    );
  });
});
