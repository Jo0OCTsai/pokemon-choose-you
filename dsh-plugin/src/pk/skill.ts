/**
 * skill 子命令（对齐 bin/pk/skill.rs）：技能目录展示与安装。内容单一源 =
 * agent-plugins/skills/（skills-raw ?raw 内嵌）；本机安装走 host/domain/skills
 * （桌面分支独有 SSH 远端安装，TS 实现不承担）。
 */
import { bundledSkillVersion, localSkillInstall, skillDirFor } from "../host/domain/skills";
import { SKILL_FILES, SKILL_MD } from "../host/skills-raw";
import { flag, parseArgs, positional, usageErr, CliError } from "./cli";

export function runSkill(rest: readonly string[]): unknown {
  const sub = rest[0] ?? "";
  const p = parseArgs(rest.slice(1));
  const dirFlag = flag(p, "dir");
  if (sub === "show") {
    let out = SKILL_MD;
    for (const [rel, content] of SKILL_FILES) {
      if (rel === "SKILL.md") continue;
      out += `\n\n---\n\n# 附：${rel}\n\n${content}`;
    }
    process.stdout.write(out);
    process.exit(0);
  }
  if (sub === "install") {
    const agent = positional(p, 0, "agent 名（claude-code / opencode / pi / dsh）");
    let dir: string;
    try {
      dir = skillDirFor(agent, dirFlag);
    } catch (e) {
      throw new CliError(e instanceof Error ? e.message : String(e), 2);
    }
    let previous: string | null;
    let path: string;
    try {
      ({ previousVersion: previous, path } = localSkillInstall(dir));
    } catch (e) {
      throw new CliError(e instanceof Error ? e.message : String(e), 1);
    }
    return {
      installed: true,
      version: bundledSkillVersion(),
      previousVersion: previous,
      updated: previous !== null && previous !== bundledSkillVersion(),
      agent,
      path,
    };
  }
  throw usageErr("skill 子命令支持 install / show，用法见 pk help");
}
