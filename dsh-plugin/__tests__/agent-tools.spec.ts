/**
 * agent 工具面命令（agentTest 连接探针 / pkSkillCheck / pkSkillInstall）：
 * 探针经 fixture 的 dispatchDeps 执行器替身（stdout 可按用例覆写）；技能检查/安装
 * 用 dir 覆盖参数指向临时目录（不碰真实 $HOME 技能目录）。
 */
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExecOutcome } from "../src/host/dispatch/executor";
import { createCommandsFixture, type CommandsFixture } from "./commandsSetup";

let f: CommandsFixture;
beforeEach(() => {
  f = createCommandsFixture();
});
afterEach(() => {
  f.close();
});

/** 探针执行器替身：返回固定 stdout（按用例注入） */
function probeStdout(stdout: string, extra: Partial<ExecOutcome> = {}): void {
  f.deps.dispatchDeps.executorFor = () => ({
    launch: async (): Promise<ExecOutcome> => ({
      exitCode: 0,
      durationMs: 5,
      stdout,
      timedOut: false,
      ...extra,
    }),
    kill: () => undefined,
  });
}

/** 直插一个 agent 配置（ai_agents 设置键，loadAgents 口径；remote 可选 = 远端 SSH 执行） */
function seedAgent(id: string, command: string, deployment?: string): void {
  f.conn
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_agents', ?)")
    .run(
      JSON.stringify([
        { id, name: id, command, args: "", historyArgs: "", workdir: "", timeoutSecs: 30, enabled: true, deployment },
      ]),
    );
}

describe("agentTest 连接探针（ai::test 同构）", () => {
  it("stdout 含 openTasks → connected true + 成功文案", async () => {
    seedAgent("ag-probe", "claude");
    probeStdout('{"openTasks":3,"now":"2026-10-15T09:00:00+08:00"}');
    const out = (await f.call("agentTest", { agentId: "ag-probe" })) as {
      ok: boolean;
      data: { connected: boolean; message: string };
    };
    expect(out.ok).toBe(true);
    expect(out.data.connected).toBe(true);
    expect(out.data.message).toContain("pk 工具链已连通");
  });

  it("探针有回复但无 pk 输出 → connected false + 白名单指引与回复片段", async () => {
    seedAgent("ag-plain", "claude");
    probeStdout("我没有找到 pk 这个命令。");
    const out = (await f.call("agentTest", { agentId: "ag-plain" })) as {
      ok: boolean;
      data: { connected: boolean; message: string };
    };
    expect(out.data.connected).toBe(false);
    expect(out.data.message).toContain("工具白名单");
    expect(out.data.message).toContain("我没有找到 pk");
  });

  it("未配置任何 agent → INVALID_ARGUMENT；超时 → connected false 带超时文案", async () => {
    const none = (await f.call("agentTest", {})) as { ok: boolean; error: { code: string } };
    expect(none.ok).toBe(false);
    expect(none.error.code).toBe("INVALID_ARGUMENT");
    seedAgent("ag-slow", "claude");
    probeStdout("", { timedOut: true });
    const out = (await f.call("agentTest", { agentId: "ag-slow" })) as {
      data: { connected: boolean; message: string };
    };
    expect(out.data.connected).toBe(false);
    expect(out.data.message).toContain("超时");
  });
});

describe("agentTest 远端 SSH agent（无 provider 不本机回落）", () => {
  it("无 provider 装配 → connected false + 远端提示（不拿本机同名 CLI 冒充探测）；有 provider 照常探测", async () => {
    seedAgent("ag-remote", "dsh", "gpu-1");
    f.deps.dispatchDeps.executorFor = () => null;
    const out = (await f.call("agentTest", { agentId: "ag-remote" })) as {
      ok: boolean;
      data: { connected: boolean; message: string };
    };
    expect(out.ok).toBe(true);
    expect(out.data.connected).toBe(false);
    expect(out.data.message).toContain("远端");
    expect(out.data.message).toContain("gpu-1");
    // 平台注入了执行器（真实 SSH provider）：远端 agent 照常经其探测
    probeStdout('{"openTasks":1}');
    const viaProvider = (await f.call("agentTest", { agentId: "ag-remote" })) as {
      data: { connected: boolean };
    };
    expect(viaProvider.data.connected).toBe(true);
  });

  it("部署绑定空白视同本地（resolve_remote_target 同语义）：无 provider 走本机执行器", async () => {
    seedAgent("ag-blank-remote", process.execPath, "   ");
    f.deps.dispatchDeps.executorFor = () => null;
    const local = (await f.call("agentTest", { agentId: "ag-blank-remote" })) as {
      data: { connected: boolean; message: string };
    };
    expect(local.data.message).not.toContain("远端");
  });
});

describe("pk 技能检查与安装（dir 覆盖指向临时目录）", () => {
  let skillDir: string;
  beforeEach(() => {
    skillDir = mkdtempSync(join(tmpdir(), "pky-skill-cmd-"));
  });
  afterEach(() => {
    rmSync(skillDir, { recursive: true, force: true });
  });

  it("未装 → installed false；安装后版本 = 内置版本，重装回 previousVersion", async () => {
    seedAgent("ag-skill", "/usr/local/bin/claude");
    const before = (await f.call("pkSkillCheck", { agentId: "ag-skill", dir: skillDir })) as {
      ok: boolean;
      data: { kind: string; installed: boolean; bundledVersion: string };
    };
    expect(before.ok).toBe(true);
    expect(before.data).toMatchObject({ kind: "claude-code", installed: false });
    const install = (await f.call("pkSkillInstall", { agentId: "ag-skill", dir: skillDir })) as {
      data: { previousVersion: string | null; version: string; path: string };
    };
    expect(install.data.previousVersion).toBeNull();
    expect(install.data.version).toBe(before.data.bundledVersion);
    expect(install.data.path.endsWith("SKILL.md")).toBe(true);
    const again = (await f.call("pkSkillInstall", { agentId: "ag-skill", dir: skillDir })) as {
      data: { previousVersion: string | null };
    };
    expect(again.data.previousVersion).toBe(before.data.bundledVersion);
    const after = (await f.call("pkSkillCheck", { agentId: "ag-skill", dir: skillDir })) as {
      data: { installed: boolean; installedVersion: string | null };
    };
    expect(after.data.installed).toBe(true);
    expect(after.data.installedVersion).toBe(before.data.bundledVersion);
  });

  it("命令推不出 kind 且无 dir 覆盖 → INVALID_ARGUMENT 带指引", async () => {
    seedAgent("ag-unknown", "my-wrapper.sh");
    const out = (await f.call("pkSkillCheck", { agentId: "ag-unknown" })) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe("INVALID_ARGUMENT");
    expect(out.error.message).toContain("技能根目录");
  });
});
