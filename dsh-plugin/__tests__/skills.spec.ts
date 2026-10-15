/**
 * pk 技能域（domain/skills）：kind 推断 / 目录定位（含 ~ 与覆盖）/ frontmatter 版本 /
 * 内嵌字节同源（与主仓 src-tauri/skills/ 磁盘文件比对）/ 安装状态与落盘往返。
 * 行为基准 = src-tauri/src/skills.rs 本机部分。
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bundledSkillVersion,
  frontmatterVersion,
  kindForCommand,
  localSkillInstall,
  localSkillStatus,
  skillDirFor,
} from "../src/host/domain/skills";
import { SKILL_FILES } from "../src/host/skills-raw";

describe("kind 推断（kind_for_command 同构）", () => {
  it("basename 关键词命中；pi/dsh 精确等值（子串不误报）", () => {
    expect(kindForCommand("claude")).toBe("claude-code");
    expect(kindForCommand("/usr/local/bin/claude")).toBe("claude-code");
    expect(kindForCommand("opencode")).toBe("opencode");
    expect(kindForCommand("pi")).toBe("pi");
    expect(kindForCommand("pi-coding-agent")).toBe("pi");
    expect(kindForCommand("dsh")).toBe("dsh");
    expect(kindForCommand("deepseek-harness")).toBe("dsh");
    // 误报守卫：copilot 含 pi 子串 / dash 含 dsh 子串——都不能命中
    expect(kindForCommand("copilot")).toBeNull();
    expect(kindForCommand("dash")).toBeNull();
    expect(kindForCommand("my-wrapper.sh")).toBeNull();
  });
});

describe("技能目录定位（skill_dir_for 同构）", () => {
  it("各 kind 的默认根目录 + 技能名子目录", () => {
    expect(skillDirFor("claude-code")).toBe(join(homedir(), ".claude/skills/pokemon-choose-you"));
    expect(skillDirFor("opencode")).toBe(join(homedir(), ".config/opencode/skill/pokemon-choose-you"));
    expect(skillDirFor("pi")).toBe(join(homedir(), ".pi/agent/skills/pokemon-choose-you"));
    expect(skillDirFor("dsh")).toBe(join(homedir(), ".dsh/skills/pokemon-choose-you"));
  });
  it("覆盖值 = 技能根目录（~ 展开；空白忽略回落默认）", () => {
    expect(skillDirFor("claude-code", "~/custom/skills")).toBe(
      join(homedir(), "custom/skills/pokemon-choose-you"),
    );
    expect(skillDirFor("claude-code", "  ")).toBe(join(homedir(), ".claude/skills/pokemon-choose-you"));
  });
  it("未知 kind 且无覆盖 → 带指引错误", () => {
    expect(() => skillDirFor("cursor")).toThrow(/暂不认识 agent「cursor」/);
  });
});

describe("frontmatter 版本与内嵌同源", () => {
  it("version 行解析（引号剥离；无 frontmatter 为 null）", () => {
    expect(frontmatterVersion('---\nname: x\nversion: "9"\n---\n正文')).toBe("9");
    expect(frontmatterVersion("---\nname: x\n---\n")).toBeNull();
    expect(frontmatterVersion("没有 frontmatter")).toBeNull();
  });

  it("内嵌三文件与主仓磁盘字节同源（skills.rs include_str 同构断言）", () => {
    const root = join(import.meta.dirname, "../../src-tauri/skills");
    expect(SKILL_FILES).toHaveLength(3);
    for (const [rel, content] of SKILL_FILES) {
      const disk = readFileSync(join(root, rel === "SKILL.md" ? "pokemon-choose-you.md" : rel), "utf8");
      expect(content).toBe(disk);
    }
    expect(bundledSkillVersion()).toMatch(/^\d+$/);
  });
});

describe("安装状态与落盘（local_status / local_install 同构）", () => {
  const dirs: string[] = [];
  const tmpDir = (): string => {
    const dir = join(homedir(), `.pky-skill-test-${Date.now()}-${dirs.length}`);
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("未安装 → installed false；安装后版本可读、references 落盘、重装返回旧版本", () => {
    const dir = tmpDir();
    expect(localSkillStatus(dir)).toEqual({ installed: false, installedVersion: null });
    const first = localSkillInstall(dir);
    expect(first.previousVersion).toBeNull();
    const status = localSkillStatus(dir);
    expect(status.installed).toBe(true);
    expect(status.installedVersion).toBe(bundledSkillVersion());
    expect(readFileSync(join(dir, "references/commands.md"), "utf8")).toContain("pk");
    // 升级路径：手写旧版本 → 重装返回旧版本号
    const skMd = readFileSync(join(dir, "SKILL.md"), "utf8").replace(`version: "${bundledSkillVersion()}"`, 'version: "8"');
    writeFileSync(join(dir, "SKILL.md"), skMd);
    const second = localSkillInstall(dir);
    expect(second.previousVersion).toBe("8");
    expect(localSkillStatus(dir).installedVersion).toBe(bundledSkillVersion());
  });
});
