/**
 * pk 使用技能的分发与版本管理（skills.rs 本机部分同构）：kind 推断 / 技能目录定位 /
 * frontmatter 版本读取 / 安装状态与落盘。远端（SSH）安装与 remote_install_script 不
 * 移植——dsh host 无 SSH provider 装配（见 debt）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { SKILL_FILES, SKILL_MD } from "../skills-raw";

export const SKILL_DIR_NAME = "pokemon-choose-you";

/**
 * 从 agent 可执行命令推断技能目标类型：basename 匹配关键词即命中（claude / opencode /
 * pi / dsh；绝对路径与自定义包装脚本也能识别）。pi 名字只有两个字母必须精确等值——
 * 子串匹配会把 copilot 之类误判成 pi；dsh 同理（dash 等含 dsh 子串的无关命令不能误报）。
 */
export function kindForCommand(command: string): string | null {
  const base =
    command
      .split(/[\\/]/)
      .filter((part) => part !== "")
      .pop() ?? command;
  const lowered = base.toLowerCase();
  if (lowered === "pi" || lowered.includes("pi-coding-agent")) {
    return "pi";
  }
  if (lowered === "dsh" || lowered.includes("deepseek")) {
    return "dsh";
  }
  if (lowered.includes("claude")) {
    return "claude-code";
  }
  if (lowered.includes("opencode")) {
    return "opencode";
  }
  return null;
}

/** 技能目录覆盖值的归一：trim 后非空才算指定 */
function dirOverride(dir: string | null | undefined): string | null {
  const trimmed = dir?.trim();
  return trimmed === undefined || trimmed === "" ? null : trimmed;
}

/**
 * 技能文件所在目录（本机绝对路径）：claude-code → ~/.claude/skills；opencode →
 * ~/.config/opencode/skill；pi → ~/.pi/agent/skills；dsh → ~/.dsh/skills；其他 agent
 * 用技能根目录字段显式指定。目录覆盖指**技能根目录**，技能本体落在 <根>/pokemon-choose-you。
 */
export function skillDirFor(kind: string, dirFlag?: string | null): string {
  const override = dirOverride(dirFlag);
  if (override !== null) {
    // ~ 前缀展开（与 agent 工作目录同语义），其余按原样（绝对/相对路径）
    if (override.startsWith("~/")) {
      return join(homedir(), override.slice(2), SKILL_DIR_NAME);
    }
    return join(override, SKILL_DIR_NAME);
  }
  const rel =
    kind === "claude-code" || kind === "claude"
      ? `.claude/skills/${SKILL_DIR_NAME}`
      : kind === "opencode"
        ? `.config/opencode/skill/${SKILL_DIR_NAME}`
        : kind === "pi"
          ? `.pi/agent/skills/${SKILL_DIR_NAME}`
          : kind === "dsh" || kind === "deepseek-harness"
            ? `.dsh/skills/${SKILL_DIR_NAME}`
            : null;
  if (rel === null) {
    throw new Error(
      `暂不认识 agent「${kind}」的技能目录：支持 claude-code / opencode / pi / dsh，其他 agent 用技能根目录字段指定`,
    );
  }
  return join(homedir(), rel);
}

/** 读 SKILL.md frontmatter 的 version 行（无 frontmatter 或无该行则 null） */
export function frontmatterVersion(md: string): string | null {
  let inFm = false;
  for (const line of md.split("\n")) {
    const t = line.trim();
    if (t === "---") {
      if (inFm) {
        break;
      }
      inFm = true;
      continue;
    }
    if (inFm && t.startsWith("version:")) {
      return t.slice("version:".length).trim().replace(/^"|"$/g, "");
    }
  }
  return null;
}

/** 内置技能版本（frontmatter version 单源——与主应用 SKILL_VERSION 同字节来源） */
export function bundledSkillVersion(): string {
  return frontmatterVersion(SKILL_MD) ?? "?";
}

/** 本机安装状态：SKILL.md 是否存在 + 已装版本（缺 frontmatter version 视为未知） */
export function localSkillStatus(dir: string): { installed: boolean; installedVersion: string | null } {
  const path = join(dir, "SKILL.md");
  if (!existsSync(path)) {
    return { installed: false, installedVersion: null };
  }
  return { installed: true, installedVersion: frontmatterVersion(readFileSync(path, "utf8")) };
}

/** 本机安装/同步：写主文件 + references/，返回旧版本（同版本重装幂等，跨版本即升级） */
export function localSkillInstall(dir: string): { previousVersion: string | null; path: string } {
  const previous = localSkillStatus(dir).installedVersion;
  for (const [rel, content] of SKILL_FILES) {
    const path = join(dir, rel);
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch (error) {
      throw new Error(`创建技能目录失败: ${String(error)}`);
    }
    try {
      writeFileSync(path, content);
    } catch (error) {
      throw new Error(`写入 ${rel} 失败: ${String(error)}`);
    }
  }
  return { previousVersion: previous, path: join(dir, "SKILL.md") };
}
