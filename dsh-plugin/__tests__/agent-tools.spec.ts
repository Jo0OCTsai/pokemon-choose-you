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

/** 直插一个 agent 配置（ai_agents 设置键，loadAgents 口径） */
function seedAgent(id: string, command: string): void {
  f.conn
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_agents', ?)")
    .run(
      JSON.stringify([
        { id, name: id, command, args: "", historyArgs: "", workdir: "", timeoutSecs: 30, enabled: true },
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
