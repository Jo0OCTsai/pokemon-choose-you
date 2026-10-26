/**
 * pk 技能检查与安装（pkSkillCheck / pkSkillInstall，从 agent-tools.spec 拆出——棘轮
 * max-lines）：dir 覆盖指向临时目录不碰真实 $HOME；未知命令 + 技能根目录覆盖兜底回归。
 */
import { rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedAgent } from "./agentToolsSeed";
import { createCommandsFixture, type CommandsFixture } from "./commandsSetup";

let f: CommandsFixture;
beforeEach(() => {
  f = createCommandsFixture();
});
afterEach(() => {
  f.close();
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
    seedAgent(f.conn, "ag-skill", "/usr/local/bin/claude");
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
});

describe("kind 推断边界（命令推不出时的目录兜底）", () => {
  let skillDir: string;
  beforeEach(() => {
    skillDir = mkdtempSync(join(tmpdir(), "pky-skill-cmd-"));
  });
  afterEach(() => {
    rmSync(skillDir, { recursive: true, force: true });
  });

  it("命令推不出 kind 且无 dir 覆盖 → INVALID_ARGUMENT 带指引", async () => {
    seedAgent(f.conn, "ag-unknown", "my-wrapper.sh");
    const out = (await f.call("pkSkillCheck", { agentId: "ag-unknown" })) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe("INVALID_ARGUMENT");
    expect(out.error.message).toContain("技能根目录");
  });

  it("命令推不出 kind 但有技能根目录（agent 配置或 dir 参数）→ 覆盖兜底，检查/安装照常", async () => {
    seedAgent(f.conn, "ag-qoder", "qodercli", undefined, "", `${skillDir}/qoder-root`);
    const check = (await f.call("pkSkillCheck", { agentId: "ag-qoder" })) as {
      ok: boolean;
      data: { kind: string; dir: string; installed: boolean };
    };
    expect(check.ok).toBe(true);
    expect(check.data.kind).toBe("custom");
    expect(check.data.dir.endsWith(join("qoder-root", "pokemon-choose-you"))).toBe(true);
    expect(check.data.installed).toBe(false);
    const install = (await f.call("pkSkillInstall", { agentId: "ag-qoder" })) as {
      ok: boolean;
      data: { previousVersion: string | null };
    };
    expect(install.ok).toBe(true);
    expect(install.data.previousVersion).toBeNull();
    // 覆盖值同样吃空白归一：agent 配置只填空白时回到参数错指引
    seedAgent(f.conn, "ag-blank", "qodercli", undefined, "", "   ");
    const blank = (await f.call("pkSkillCheck", { agentId: "ag-blank" })) as {
      ok: boolean;
      error: { code: string };
    };
    expect(blank.ok).toBe(false);
    expect(blank.error.code).toBe("INVALID_ARGUMENT");
  });
});
